"""
Danbooru API Proxy for ComfyUI
Provides a backend endpoint to fetch tag information from Danbooru.donmai.us
Handles CORS restrictions, caching, and rate limiting.
"""

import asyncio
import aiohttp
import time
import random
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from server import PromptServer
from aiohttp import web
import logging

logger = logging.getLogger(__name__)

RandomShit = [
    "apple",
    "banana",
    "cherry",
    "date",
    "elderberry",
    "fig",
    "ThankYouMom",
    "grape",
    "honeydew",
    "magic",
    "peel",
    "rock",
    "paper",
    "scissors",
    "hahaIwon",
    "lizard",
    "spock",
    "LookMomNoHands",
    "unicorn",
    "IAmTheOneWhoKnocks",
    "unexpected",
    "RapidUnplannedDisassembly",
    "IAmGroot",
    "IAmActuallyRunningOutOfIdeas",
    "ButterflyEffect",
    "CopilotIsMyCoPilot",
    "ILoveTypeScript",
    "CodeIsPoetry",
    "DebuggingIsFun",
    "IHateMyLife",
    "zoomer",
    "fart",
    "sussy",
    "IGIveUp",
    "NeverGonnaGiveYouUp",
    "neverGonnaLetYouDown",
    "neverGonnaRunAroundAndDesertYou",
    "neverGonnaMakeYouCry",
    "neverGonnaSayGoodbye",
    "neverGonnaTellALieAndHurtYou",
    "ThisIsFine",
    "IAmNotAMorningPerson",
    "IAmNotARobot",
    "whatAmIDoingWithMyLife",
]


# ─── User-Agent persistence file ──────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "library"
UA_FILE = DATA_DIR / "danbooru_working_ua.txt"


class DanbooruProxy:
    def __init__(self):
        self.tag_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_expiry: Dict[str, datetime] = {}
        self.request_times = []
        self.cache_ttl = timedelta(hours=1)
        self.rate_limit = 2  # requests per second
        self.user_agent = self._load_or_generate_ua()

    # ── User-Agent helpers ────────────────────────────────────────────────────

    @staticmethod
    def _randomize_word(word: str) -> str:
        """Randomize the capitalization of a word."""
        strategy = random.choice(["original", "upper", "lower", "title", "random"])
        if strategy == "original":
            return word
        if strategy == "upper":
            return word.upper()
        if strategy == "lower":
            return word.lower()
        if strategy == "title":
            return word.title()
        # Random per-character
        return "".join(
            c.upper() if random.random() > 0.5 else c.lower() for c in word
        )

    @staticmethod
    def _random_spacing() -> str:
        """Return a random separator between words (space, hyphen, nothing, dot, underscore)."""
        return random.choice([" ", "-", "", ".", "_"])

    def _generate_ua(self) -> str:
        """Build a random User-Agent from 1-4 random words + a version slug."""
        count = random.randint(1, 4)
        words = [self._randomize_word(random.choice(RandomShit)) for _ in range(count)]
        sep = self._random_spacing()
        body = sep.join(words)
        version = f"{random.randint(1, 9)}.{random.randint(0, 9)}"
        return f"{body}/{version}"

    def _load_or_generate_ua(self) -> str:
        """Try to restore a previously-saved working UA; otherwise generate one."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if UA_FILE.exists():
            try:
                saved = UA_FILE.read_text(encoding="utf-8").strip()
                if saved:
                    logger.info(f"Restored saved User-Agent: {saved}")
                    return saved
            except Exception:
                pass
        ua = self._generate_ua()
        logger.info(f"Generated new User-Agent: {ua}")
        return ua

    def _save_ua(self):
        """Persist the current working User-Agent to disk."""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            UA_FILE.write_text(self.user_agent, encoding="utf-8")
            logger.info(f"Saved working User-Agent: {self.user_agent}")
        except Exception as e:
            logger.warning(f"Could not save User-Agent file: {e}")

    def _rotate_ua(self):
        """Discard the current (blocked) UA and generate a new one."""
        old = self.user_agent
        self.user_agent = self._generate_ua()
        logger.warning(f"UA blocked (403), rotating: {old!r} → {self.user_agent!r}")

    def check_rate_limit(self) -> bool:
        """Check if we're within Danbooru's rate limit (2 req/sec for anonymous)"""
        now = time.time()
        # Remove requests older than 1 second
        self.request_times = [t for t in self.request_times if now - t < 1.0]

        if len(self.request_times) >= self.rate_limit:
            return False

        self.request_times.append(now)
        return True

    def get_cached(self, tag: str) -> Optional[Dict[str, Any]]:
        """Get cached tag info if available and not expired"""
        if tag in self.tag_cache:
            if tag in self.cache_expiry and datetime.now() < self.cache_expiry[tag]:
                return self.tag_cache[tag]
            else:
                del self.tag_cache[tag]
                if tag in self.cache_expiry:
                    del self.cache_expiry[tag]
        return None

    def set_cache(self, tag: str, data: Dict[str, Any]):
        """Cache tag info with expiry time"""
        self.tag_cache[tag] = data
        self.cache_expiry[tag] = datetime.now() + self.cache_ttl

    async def _do_fetch(self, normalized_tag: str) -> tuple[Dict[str, Any], bool]:
        """
        Core fetch logic. Returns (result_dict, was_blocked).
        `was_blocked` is True when we got a 403 (UA blocked).
        """
        result = {"tag": None, "wiki": None, "posts": None, "error": None}
        headers = {"User-Agent": self.user_agent}

        async with aiohttp.ClientSession() as session:
            # Fetch tag metadata
            tag_url = "https://danbooru.donmai.us/tags.json"
            params = {"search[name_matches]": normalized_tag, "limit": 1}

            async with session.get(
                tag_url, params=params, headers=headers, timeout=10
            ) as response:
                if response.status == 403:
                    return result, True
                if response.status == 200:
                    tag_data = await response.json()
                    if tag_data and len(tag_data) > 0:
                        result["tag"] = tag_data[0]
                    else:
                        result["error"] = "Tag not found"
                        return result, False
                elif response.status == 429:
                    result["error"] = "Rate limited by Danbooru"
                    return result, False
                else:
                    result["error"] = f"API error: {response.status}"
                    return result, False

            # Fetch wiki page
            wiki_url = (
                f"https://danbooru.donmai.us/wiki_pages/{normalized_tag}.json"
            )
            async with session.get(
                wiki_url, headers=headers, timeout=10
            ) as response:
                if response.status == 403:
                    return result, True
                if response.status == 200:
                    result["wiki"] = await response.json()

            # Fetch example post (for thumbnail)
            posts_url = "https://danbooru.donmai.us/posts.json"
            posts_params = {"tags": normalized_tag, "limit": 1, "random": "true"}
            async with session.get(
                posts_url, params=posts_params, headers=headers, timeout=10
            ) as response:
                if response.status == 403:
                    return result, True
                if response.status == 200:
                    posts_data = await response.json()
                    if posts_data and len(posts_data) > 0:
                        result["posts"] = posts_data[0]

        return result, False

    async def fetch_tag_info(self, tag: str) -> Dict[str, Any]:
        """Fetch tag information from Danbooru API, auto-rotating UA on 403."""
        normalized_tag = tag.lower().strip().replace(" ", "_")

        cached = self.get_cached(normalized_tag)
        if cached:
            logger.debug(f"Cache hit for tag: {normalized_tag}")
            return cached

        if not self.check_rate_limit():
            logger.warning("Rate limit exceeded, returning cached data or error")
            return {
                "error": "Rate limit exceeded, please wait a moment",
                "cached": True,
            }

        max_retries = 10  # max UA rotations before giving up

        try:
            for attempt in range(max_retries + 1):
                try:
                    result, was_blocked = await self._do_fetch(normalized_tag)

                    if was_blocked:
                        self._rotate_ua()
                        continue

                    # Success — persist the working UA (only on first success)
                    if attempt > 0 or not UA_FILE.exists():
                        self._save_ua()

                    # Cache successful result
                    if result["tag"]:
                        self.set_cache(normalized_tag, result)
                        logger.info(f"Cached tag info for: {normalized_tag}")

                    return result

                except asyncio.TimeoutError:
                    logger.error(f"Timeout fetching tag: {normalized_tag}")
                    return {"tag": None, "wiki": None, "posts": None, "error": "Request timeout"}

            # Exhausted all retries
            logger.error(f"All {max_retries} UA rotations blocked for tag: {normalized_tag}")
            return {"tag": None, "wiki": None, "posts": None, "error": "User-Agent blocked; exhausted retries"}

        except Exception as e:
            logger.error(f"Error fetching tag {normalized_tag}: {str(e)}")
            return {"tag": None, "wiki": None, "posts": None, "error": str(e)}


# Global instance
proxy = DanbooruProxy()


def register_routes():
    """Register API routes with ComfyUI's PromptServer"""

    @PromptServer.instance.routes.get("/api/danbooru/tag/{tag}")
    async def get_tag_info(request):
        tag = request.match_info["tag"]

        if not tag or len(tag.strip()) == 0:
            return web.json_response({"error": "Tag parameter is required"}, status=400)

        # Fetch tag info
        result = await proxy.fetch_tag_info(tag)

        if result.get("error") and not result.get("cached"):
            status = 404 if "not found" in result["error"].lower() else 500
            return web.json_response(result, status=status)

        return web.json_response(result)

    logger.info("Danbooru API proxy routes registered")


# Auto-register when module is imported
register_routes()
