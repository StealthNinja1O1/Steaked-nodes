"""
Booru proxy routes and request orchestration.

Routes:
  GET /api/booru/providers                    – provider list + capabilities
  GET /api/booru/{provider}/tag/{tag}         – tag meta + wiki + example post
  GET /api/booru/{provider}/wiki/{tag}        – full wiki body
  GET /api/booru/{provider}/posts/{tag}       – paginated post list
Legacy:
  GET /api/danbooru/tag/{tag}                 – alias of /api/booru/danbooru/tag/{tag}
"""

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
from aiohttp import web
from server import PromptServer

from .providers import PROVIDERS, PROVIDER_META, BooruAdapter, ProviderError

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent.parent / "library"
UA_FILE = DATA_DIR / "booru_working_ua.txt"
SETTINGS_FILE = DATA_DIR / "booru_settings.json"

UA_WORDS = [
    "apple", "banana", "cherry", "date", "elderberry", "fig", "ThankYouMom",
    "grape", "honeydew", "magic", "peel", "rock", "paper", "scissors",
    "hahaIwon", "lizard", "spock", "LookMomNoHands", "unicorn",
    "IAmTheOneWhoKnocks", "unexpected", "RapidUnplannedDisassembly",
    "IAmGroot", "IAmActuallyRunningOutOfIdeas", "ButterflyEffect",
    "CopilotIsMyCoPilot", "ILoveTypeScript", "CodeIsPoetry", "DebuggingIsFun",
    "IHateMyLife", "zoomer", "fart", "sussy", "IGIveUp", "NeverGonnaGiveYouUp",
    "ThisIsFine", "IAmNotAMorningPerson", "IAmNotARobot",
    "whatAmIDoingWithMyLife",
]

MAX_UA_ROTATIONS = 10


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        import json

        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return fallback


def _write_json(path: Path, data: Any):
    try:
        import json

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Could not write {path}: {e}")


class BooruProxy:
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_expiry: Dict[str, datetime] = {}
        self.request_times: Dict[str, list] = {}
        self.cache_ttl = timedelta(hours=1)
        self.rate_limit = 2  # requests/sec per provider
        settings = _read_json(SETTINGS_FILE, {})
        self.user_agent = self._load_or_generate_ua()
        self.api_keys: Dict[str, Dict[str, str]] = settings.get("api_keys", {})

    # ── User-Agent handling (danbooru blocks obviously-scripted UAs) ─────────

    @staticmethod
    def _randomize_word(word: str) -> str:
        strategy = random.choice(["original", "upper", "lower", "title", "random"])
        if strategy == "original":
            return word
        if strategy == "upper":
            return word.upper()
        if strategy == "lower":
            return word.lower()
        if strategy == "title":
            return word.title()
        return "".join(c.upper() if random.random() > 0.5 else c.lower() for c in word)

    def _generate_ua(self) -> str:
        count = random.randint(1, 4)
        words = [self._randomize_word(random.choice(UA_WORDS)) for _ in range(count)]
        body = random.choice([" ", "-", "", ".", "_"]).join(words)
        return f"{body}/{random.randint(1, 9)}.{random.randint(0, 9)}"

    def _load_or_generate_ua(self) -> str:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if UA_FILE.exists():
            try:
                saved = UA_FILE.read_text(encoding="utf-8").strip()
                if saved:
                    return saved
            except Exception:
                pass
        return self._generate_ua()

    def _save_ua(self):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            UA_FILE.write_text(self.user_agent, encoding="utf-8")
        except Exception as e:
            logger.warning(f"Could not save User-Agent file: {e}")

    def rotate_ua(self):
        old = self.user_agent
        self.user_agent = self._generate_ua()
        logger.warning(f"UA blocked (403), rotating: {old!r} → {self.user_agent!r}")

    def get_adapter(self, provider: str, user_agent: Optional[str] = None) -> BooruAdapter:
        cls = PROVIDERS.get(provider)
        if not cls:
            raise ProviderError(f"Unknown provider: {provider}", status=400)
        creds = self.api_keys.get(provider, {})
        return cls(
            user_agent=user_agent or self.user_agent,
            api_key=creds.get("api_key"),
            user_id=creds.get("user_id"),
        )

    # ── Rate limiting + cache ─────────────────────────────────────────────────

    def check_rate_limit(self, provider: str) -> bool:
        now = time.time()
        times = [t for t in self.request_times.get(provider, []) if now - t < 1.0]
        if len(times) >= self.rate_limit:
            self.request_times[provider] = times
            return False
        times.append(now)
        self.request_times[provider] = times
        return True

    def get_cached(self, key: str) -> Optional[Any]:
        if key in self.cache:
            if datetime.now() < self.cache_expiry.get(key, datetime.min):
                return self.cache[key]
            self.cache.pop(key, None)
            self.cache_expiry.pop(key, None)
        return None

    def set_cache(self, key: str, data: Any):
        self.cache[key] = data
        self.cache_expiry[key] = datetime.now() + self.cache_ttl

    # ── Fetch orchestration with UA rotation ─────────────────────────────────

    async def _run(self, provider: str, cache_key: str, fn):
        cached = self.get_cached(cache_key)
        if cached is not None:
            return cached
        if not self.check_rate_limit(provider):
            raise ProviderError("Rate limit exceeded, please wait a moment", status=429)

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
            for attempt in range(MAX_UA_ROTATIONS + 1):
                adapter = self.get_adapter(provider)
                try:
                    result = await fn(adapter, session)
                    if attempt > 0 or not UA_FILE.exists():
                        self._save_ua()
                    if result is not None:
                        self.set_cache(cache_key, result)
                    return result
                except ProviderError as e:
                    if e.blocked and attempt < MAX_UA_ROTATIONS:
                        self.rotate_ua()
                        continue
                    raise
                except asyncio.TimeoutError:
                    raise ProviderError("Request timeout", status=504)
        raise ProviderError("User-Agent blocked; exhausted retries", status=403)

    async def fetch_tag_info(self, provider: str, tag: str) -> Dict[str, Any]:
        """Tag meta + wiki + one random example post. Falls back to danbooru
        for wiki/meta when the provider can't supply them."""
        tag = tag.lower().strip().replace(" ", "_")
        return await self._run(provider, f"tag:{provider}:{tag}", self._make_tag_info_job(tag))

    def _make_tag_info_job(self, tag: str):
        async def job(adapter, session):
            result: Dict[str, Any] = {"tag": None, "wiki": None, "posts": None, "error": None}

            result["tag"] = await adapter.fetch_tag_meta(session, tag)

            if not adapter.supports_wiki:
                # safebooru etc: borrow wiki knowledge from danbooru
                try:
                    fallback = self.get_adapter("danbooru", user_agent=adapter.user_agent)
                    result["wiki"] = await fallback.fetch_wiki(session, tag)
                except ProviderError as e:
                    if e.blocked:
                        raise
            else:
                result["wiki"] = await adapter.fetch_wiki(session, tag)

            try:
                posts = await adapter.fetch_posts(session, tag, limit=1, random=True)
                result["posts"] = posts[0] if posts else None
            except ProviderError:
                pass  # thumbnail is optional

            return result

        return job

    async def fetch_wiki(self, provider: str, tag: str) -> Dict[str, Any]:
        tag = tag.lower().strip().replace(" ", "_")
        adapter = self.get_adapter(provider)
        if not adapter.supports_wiki:
            adapter = self.get_adapter("danbooru")

        async def job(a, s):
            wiki = await a.fetch_wiki(s, tag)
            return wiki or {"title": tag, "body": None}

        return await self._run(adapter.name, f"wiki:{adapter.name}:{tag}", job)

    async def fetch_posts(self, provider: str, tag: str, limit: int, page: int, random: bool):
        tag = tag.lower().strip().replace(" ", "_")
        return await self._run(
            provider,
            f"posts:{provider}:{tag}:{limit}:{page}:{random}",
            lambda a, s: a.fetch_posts(s, tag, limit=limit, page=page, random=random),
        )

    # ── Settings ──────────────────────────────────────────────────────────────

    def save_settings(self):
        _write_json(SETTINGS_FILE, {"api_keys": self.api_keys})


proxy = BooruProxy()


def _error_response(e: ProviderError):
    return web.json_response({"error": str(e)}, status=e.status)


def register_routes():
    @PromptServer.instance.routes.get("/api/booru/providers")
    async def list_providers(request):
        return web.json_response(PROVIDER_META)

    @PromptServer.instance.routes.get("/api/booru/{provider}/tag/{tag}")
    async def get_tag_info(request):
        provider = request.match_info["provider"]
        tag = request.match_info["tag"]
        if not tag.strip():
            return web.json_response({"error": "Tag parameter is required"}, status=400)
        try:
            result = await proxy.fetch_tag_info(provider, tag)
            if result.get("tag") is None and result.get("posts") is None and not result.get("wiki"):
                return web.json_response({**result, "error": "Tag not found"}, status=404)
            return web.json_response(result)
        except ProviderError as e:
            return _error_response(e)

    @PromptServer.instance.routes.get("/api/booru/{provider}/wiki/{tag}")
    async def get_wiki(request):
        provider = request.match_info["provider"]
        tag = request.match_info["tag"]
        try:
            return web.json_response(await proxy.fetch_wiki(provider, tag))
        except ProviderError as e:
            return _error_response(e)

    @PromptServer.instance.routes.get("/api/booru/{provider}/posts/{tag}")
    async def get_posts(request):
        provider = request.match_info["provider"]
        tag = request.match_info["tag"]
        limit = min(int(request.query.get("limit", 20)), 100)
        page = max(int(request.query.get("page", 1)), 1)
        random = request.query.get("random", "false") == "true"
        try:
            posts = await proxy.fetch_posts(provider, tag, limit, page, random)
            return web.json_response({"posts": posts or []})
        except ProviderError as e:
            return _error_response(e)

    @PromptServer.instance.routes.get("/api/booru/settings/keys/{provider}")
    async def get_key_status(request):
        provider = request.match_info["provider"]
        creds = proxy.api_keys.get(provider, {})
        return web.json_response({"has_key": bool(creds.get("api_key"))})

    @PromptServer.instance.routes.post("/api/booru/settings/keys/{provider}")
    async def set_key(request):
        provider = request.match_info["provider"]
        if provider not in PROVIDERS:
            return web.json_response({"error": "Unknown provider"}, status=400)
        body = await request.json()
        proxy.api_keys.setdefault(provider, {})
        if body.get("api_key"):
            proxy.api_keys[provider]["api_key"] = body["api_key"]
        else:
            proxy.api_keys[provider].pop("api_key", None)
        if body.get("user_id"):
            proxy.api_keys[provider]["user_id"] = str(body["user_id"])
        else:
            proxy.api_keys[provider].pop("user_id", None)
        proxy.save_settings()
        return web.json_response({"ok": True})

    # Legacy alias
    @PromptServer.instance.routes.get("/api/danbooru/tag/{tag}")
    async def legacy_tag_info(request):
        tag = request.match_info["tag"]
        try:
            result = await proxy.fetch_tag_info("danbooru", tag)
            if result.get("tag") is None and result.get("posts") is None and not result.get("wiki"):
                return web.json_response({**result, "error": "Tag not found"}, status=404)
            return web.json_response(result)
        except ProviderError as e:
            return _error_response(e)

    logger.info("Booru API proxy routes registered")
