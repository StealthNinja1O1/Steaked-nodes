"""
Per-booru API adapters.

Each adapter maps a booru's native API onto the common shapes used by the
routes and the frontend:

Tag:      {name, post_count, category, is_deprecated}
Wiki:     {title, body}
Post:     {id, preview_url, file_url, sample_url, width, height, tags,
           rating, score, source, post_url}
"""

import re
from typing import Any, Dict, List, Optional

import aiohttp

# Danbooru-compatible category ids
CATEGORY_GENERAL = 0
CATEGORY_ARTIST = 1
CATEGORY_COPYRIGHT = 3
CATEGORY_CHARACTER = 4
CATEGORY_META = 5

# moebooru (yande.re / konachan) type ids differ: 0 general, 1 artist,
# 3 copyright, 4 character, 5 meta, 6 circle, 7 fault
MOEBOORU_CATEGORY_MAP = {0: 0, 1: 1, 2: 3, 3: 4, 4: 5}

RATING_NAMES = {"g": "general", "s": "sensitive", "q": "questionable", "e": "explicit"}


class ProviderError(Exception):
    """Raised for provider-level failures that should not be retried."""

    def __init__(self, message: str, status: int = 500, blocked: bool = False):
        super().__init__(message)
        self.status = status
        self.blocked = blocked


class BooruAdapter:
    """Base class. Subclasses implement the three fetch methods."""

    name = "unknown"
    base_url = ""
    # Boorus that serve adult content; purely informational for the frontend.
    sfw = False
    # Whether this provider can supply tag counts / categories natively.
    supports_tag_meta = True
    supports_wiki = True
    # Optional api key support (gelbooru/rule34)
    supports_api_key = False

    def __init__(self, user_agent: str, api_key: Optional[str] = None, user_id: Optional[str] = None):
        self.user_agent = user_agent
        self.api_key = api_key
        self.user_id = user_id

    @property
    def headers(self) -> Dict[str, str]:
        return {"User-Agent": self.user_agent}

    async def fetch_tag_meta(self, session: aiohttp.ClientSession, tag: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    async def fetch_wiki(self, session: aiohttp.ClientSession, tag: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    async def fetch_posts(self, session: aiohttp.ClientSession, tag: str, limit: int = 20, page: int = 1, random: bool = False) -> List[Dict[str, Any]]:
        raise NotImplementedError

    @staticmethod
    async def _json(response: aiohttp.ClientResponse) -> Any:
        if response.status == 404:
            return None
        if response.status == 403:
            raise ProviderError("Blocked", status=403, blocked=True)
        if response.status == 429:
            raise ProviderError("Rate limited", status=429)
        if response.status == 401:
            raise ProviderError(
                "This booru requires an API key (set it in the Steaked booru settings)",
                status=401,
            )
        if response.status != 200:
            raise ProviderError(f"API error: {response.status}")
        return await response.json(content_type=None)

    # ── DText helpers (danbooru wiki markup) ─────────────────────────────────

    @staticmethod
    def dtext_excerpt(body: str, max_len: int = 250) -> str:
        text = re.sub(r"^h[1-6]\.\s+", "", body, flags=re.M)
        text = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), text)
        text = re.sub(r'"([^"]+)":\S+', r"\1", text)
        text = re.sub(r"\[/?[bice]\]|\[/?quote\]", "", text)
        paragraphs = [p for p in re.split(r"\n\n+", text) if p.strip()]
        excerpt = paragraphs[0].strip() if paragraphs else ""
        if len(excerpt) > max_len:
            excerpt = excerpt[:max_len] + "..."
        return excerpt

    @staticmethod
    def dtext_related_tags(body: str, limit: int = 5) -> List[str]:
        m = re.search(r"h[1-6]\.\s*See [Aa]lso\s*\n+(.*?)(?=\n\nh[1-6\.]|$)", body, re.S)
        if not m:
            return []
        tags = []
        for link in re.findall(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", m.group(1)):
            tag = link.strip().lower().replace(" ", "_")
            if tag and tag not in tags:
                tags.append(tag)
        return tags[:limit]


# ─── Danbooru ─────────────────────────────────────────────────────────────────


class DanbooruAdapter(BooruAdapter):
    name = "danbooru"
    base_url = "https://danbooru.donmai.us"

    async def fetch_tag_meta(self, session, tag):
        data = await self._json(
            await session.get(
                f"{self.base_url}/tags.json",
                params={"search[name_matches]": tag, "limit": 1},
                headers=self.headers,
            )
        )
        if not data:
            return None
        t = data[0]
        return {
            "name": t.get("name"),
            "post_count": t.get("post_count", 0),
            "category": t.get("category", 0),
            "is_deprecated": t.get("is_deprecated", False),
        }

    async def fetch_wiki(self, session, tag):
        data = await self._json(
            await session.get(
                f"{self.base_url}/wiki_pages/{tag}.json",
                headers=self.headers,
            )
        )
        if not data or not data.get("body"):
            return None
        return {"title": data.get("title", tag), "body": data["body"]}

    async def fetch_posts(self, session, tag, limit=20, page=1, random=False):
        params = {"tags": tag, "limit": limit, "page": page}
        if random:
            params["random"] = "true"
        data = await self._json(
            await session.get(f"{self.base_url}/posts.json", params=params, headers=self.headers)
        )
        posts = []
        for p in data or []:
            posts.append(
                {
                    "id": p.get("id"),
                    "preview_url": p.get("preview_file_url"),
                    "sample_url": p.get("large_file_url") or p.get("file_url"),
                    "file_url": p.get("file_url"),
                    "width": p.get("image_width"),
                    "height": p.get("image_height"),
                    "tags": (p.get("tag_string") or "").split(),
                    "rating": p.get("rating"),
                    "score": p.get("score"),
                    "source": p.get("source"),
                    "post_url": f"{self.base_url}/posts/{p.get('id')}",
                }
            )
        return posts


# ─── e621 (own JSON shape) ────────────────────────────────────────────────────


class E621Adapter(BooruAdapter):
    name = "e621"
    base_url = "https://e621.net"

    async def fetch_tag_meta(self, session, tag):
        data = await self._json(
            await session.get(
                f"{self.base_url}/tags.json",
                params={"search[name]": tag, "limit": 1},
                headers=self.headers,
            )
        )
        if not data:
            return None
        t = data[0]
        return {
            "name": t.get("name"),
            "post_count": t.get("post_count", 0),
            "category": t.get("category", 0),
            "is_deprecated": t.get("is_deprecated", False),
        }

    async def fetch_wiki(self, session, tag):
        data = await self._json(
            await session.get(
                f"{self.base_url}/wiki_pages.json",
                params={"search[title]": tag, "limit": 1},
                headers=self.headers,
            )
        )
        if not data or not data[0].get("body"):
            return None
        return {"title": data[0].get("title", tag), "body": data[0]["body"]}

    async def fetch_posts(self, session, tag, limit=20, page=1, random=False):
        params = {"tags": tag, "limit": limit, "page": page}
        if random:
            params.pop("page", None)
            params["tags"] = f"order:random {tag}"
        data = await self._json(
            await session.get(f"{self.base_url}/posts.json", params=params, headers=self.headers)
        )
        posts = []
        for p in (data or {}).get("posts", []):
            posts.append(
                {
                    "id": p.get("id"),
                    "preview_url": (p.get("preview") or {}).get("url"),
                    "sample_url": (p.get("sample") or {}).get("url") or (p.get("file") or {}).get("url"),
                    "file_url": (p.get("file") or {}).get("url"),
                    "width": (p.get("file") or {}).get("width"),
                    "height": (p.get("file") or {}).get("height"),
                    "tags": [t for cats in (p.get("tags") or {}).values() for t in cats],
                    "rating": p.get("rating"),
                    "score": (p.get("score") or {}).get("total"),
                    "source": (p.get("sources") or [None])[0] if p.get("sources") else None,
                    "post_url": f"{self.base_url}/posts/{p.get('id')}",
                }
            )
        return posts


# ─── Moebooru (yande.re / konachan) ──────────────────────────────────────────


class MoebooruAdapter(BooruAdapter):
    name = "moebooru"
    base_url = ""
    # wiki.json ignores the title param server-side, so wiki falls back to danbooru
    supports_wiki = False

    async def fetch_tag_meta(self, session, tag):
        data = await self._json(
            await session.get(
                f"{self.base_url}/tag.json",
                params={"name": tag, "limit": 100},
                headers=self.headers,
            )
        )
        if not data:
            return None
        # name= is a suffix match; find the exact entry
        for t in data:
            if t.get("name") == tag:
                return {
                    "name": t["name"],
                    "post_count": t.get("count", 0),
                    "category": MOEBOORU_CATEGORY_MAP.get(t.get("type", 0), 0),
                    "is_deprecated": False,
                }
        return None

    async def fetch_wiki(self, session, tag):
        return None

    async def fetch_posts(self, session, tag, limit=20, page=1, random=False):
        params = {"tags": tag, "limit": limit, "page": page}
        if random:
            params["tags"] = f"order:random {tag}"
        data = await self._json(
            await session.get(f"{self.base_url}/post.json", params=params, headers=self.headers)
        )
        posts = []
        for p in data or []:
            posts.append(
                {
                    "id": p.get("id"),
                    "preview_url": p.get("preview_url"),
                    "sample_url": p.get("sample_url") or p.get("file_url"),
                    "file_url": p.get("file_url"),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "tags": (p.get("tags") or "").split(),
                    "rating": p.get("rating"),
                    "score": p.get("score"),
                    "source": p.get("source"),
                    "post_url": f"{self.base_url}/post/show/{p.get('id')}",
                }
            )
        return posts


class YandereAdapter(MoebooruAdapter):
    name = "yandere"
    base_url = "https://yande.re"


class KonachanAdapter(MoebooruAdapter):
    name = "konachan"
    base_url = "https://konachan.com"
    sfw = True


# ─── Gelbooru-style (gelbooru / safebooru / rule34) ───────────────────────────


GELBOORU_TYPE_MAP = {0: CATEGORY_GENERAL, 1: CATEGORY_ARTIST, 3: CATEGORY_COPYRIGHT, 4: CATEGORY_CHARACTER, 5: CATEGORY_META}


class GelbooruStyleAdapter(BooruAdapter):
    name = "gelbooru"
    base_url = "https://gelbooru.com"
    supports_api_key = True
    supports_wiki = False  # only HTML wiki, no JSON API
    requires_key = True  # dapi demands account credentials since 2025

    def _dapi(self, s: str, q: str) -> Dict[str, Any]:
        params = {"page": "dapi", "s": s, "q": q}
        if self.api_key:
            params["api_key"] = self.api_key
            if self.user_id:
                params["user_id"] = self.user_id
        return params

    async def fetch_tag_meta(self, session, tag):
        # s=tag returns XML even with json=1; parse it minimally
        params = self._dapi("tag", "index")
        params["name"] = tag
        async with session.get(self.base_url, params=params, headers=self.headers) as resp:
            body = await self._text(resp)
        if body is None:
            return None
        m = re.search(
            rf'<tag type="(\d+)" count="(\d+)" name="([^"]+)"', body
        )
        if not m or m.group(3) != tag:
            return None
        return {
            "name": m.group(3),
            "post_count": int(m.group(2)),
            "category": GELBOORU_TYPE_MAP.get(int(m.group(1)), 0),
            "is_deprecated": False,
        }

    async def _text(self, resp: aiohttp.ClientResponse) -> Optional[str]:
        if resp.status == 404:
            return None
        if resp.status == 403:
            raise ProviderError("Blocked", status=403, blocked=True)
        if resp.status == 429:
            raise ProviderError("Rate limited", status=429)
        if resp.status == 401:
            raise ProviderError(
                "This booru requires an API key (set it in the Steaked booru settings)",
                status=401,
            )
        if resp.status != 200:
            raise ProviderError(f"API error: {resp.status}")
        return await resp.text()

    async def fetch_wiki(self, session, tag):
        return None

    async def fetch_posts(self, session, tag, limit=20, page=1, random=False):
        params = self._dapi("post", "index")
        params.update({"tags": tag, "limit": limit, "pid": page - 1, "json": 1})
        data = await self._json(
            await session.get(self.base_url, params=params, headers=self.headers)
        )
        if isinstance(data, dict):  # gelbooru 0.2.5 wraps in {"@attributes":..., "post": [...]}
            data = data.get("post") or []
        posts = []
        for p in data or []:
            if not isinstance(p, dict):
                continue
            posts.append(
                {
                    "id": p.get("id"),
                    "preview_url": p.get("preview_url") or p.get("preview_url"),
                    "sample_url": p.get("sample_url") or p.get("file_url"),
                    "file_url": p.get("file_url"),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "tags": (p.get("tags") or "").split(),
                    "rating": p.get("rating"),
                    "score": p.get("score"),
                    "source": p.get("source"),
                    "post_url": f"{self.base_url}/index.php?page=post&s=view&id={p.get('id')}",
                }
            )
        return posts


class GelbooruAdapter(GelbooruStyleAdapter):
    name = "gelbooru"
    base_url = "https://gelbooru.com"


class SafebooruAdapter(GelbooruStyleAdapter):
    name = "safebooru"
    base_url = "https://safebooru.org"
    sfw = True


class Rule34Adapter(GelbooruStyleAdapter):
    name = "rule34"
    base_url = "https://api.rule34.xxx"


PROVIDERS: Dict[str, BooruAdapter] = {
    "danbooru": DanbooruAdapter,
    "safebooru": SafebooruAdapter,
    "gelbooru": GelbooruAdapter,
    "yandere": YandereAdapter,
    "konachan": KonachanAdapter,
    "e621": E621Adapter,
    "rule34": Rule34Adapter,
}

PROVIDER_META = {
    name: {
        "sfw": cls.sfw,
        "supports_wiki": cls.supports_wiki,
        "requires_key": getattr(cls, "requires_key", False),
    }
    for name, cls in PROVIDERS.items()
}
