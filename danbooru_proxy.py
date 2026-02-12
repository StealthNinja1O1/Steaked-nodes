"""
Danbooru API Proxy for ComfyUI
Provides a backend endpoint to fetch tag information from Danbooru.donmai.us
Handles CORS restrictions, caching, and rate limiting.
"""

import asyncio
import aiohttp
import time
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from server import PromptServer
from aiohttp import web
import logging

logger = logging.getLogger(__name__)


class DanbooruProxy:
    def __init__(self):
        self.tag_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_expiry: Dict[str, datetime] = {}
        self.request_times = []
        self.cache_ttl = timedelta(hours=1)
        self.rate_limit = 2  # requests per second
        self.user_agent = "ComfyUI Danbooru Proxy/1.0"
        
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
    
    async def fetch_tag_info(self, tag: str) -> Dict[str, Any]:
        """Fetch tag information from Danbooru API"""
        normalized_tag = tag.lower().strip().replace(' ', '_')
        
        cached = self.get_cached(normalized_tag)
        if cached:
            logger.debug(f"Cache hit for tag: {normalized_tag}")
            return cached
        
        if not self.check_rate_limit():
            logger.warning("Rate limit exceeded, returning cached data or error")
            return {"error": "Rate limit exceeded, please wait a moment", "cached": True}
        
        result = {
            "tag": None,
            "wiki": None,
            "posts": None,
            "error": None
        }
        
        headers = {
            "User-Agent": self.user_agent
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                # Fetch tag metadata
                tag_url = f"https://danbooru.donmai.us/tags.json"
                params = {"search[name_matches]": normalized_tag, "limit": 1}
                
                async with session.get(tag_url, params=params, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        tag_data = await response.json()
                        if tag_data and len(tag_data) > 0:
                            result["tag"] = tag_data[0]
                        else:
                            result["error"] = "Tag not found"
                            return result
                    elif response.status == 429:
                        result["error"] = "Rate limited by Danbooru"
                        return result
                    else:
                        result["error"] = f"API error: {response.status}"
                        return result
                
                # Fetch wiki page
                wiki_url = f"https://danbooru.donmai.us/wiki_pages/{normalized_tag}.json"
                async with session.get(wiki_url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        result["wiki"] = await response.json()
                
                # Fetch example post (for thumbnail)
                posts_url = f"https://danbooru.donmai.us/posts.json"
                posts_params = {"tags": normalized_tag, "limit": 1, "random": "true"}
                async with session.get(posts_url, params=posts_params, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        posts_data = await response.json()
                        if posts_data and len(posts_data) > 0:
                            result["posts"] = posts_data[0]
                
                # Cache successful result
                if result["tag"]:
                    self.set_cache(normalized_tag, result)
                    logger.info(f"Cached tag info for: {normalized_tag}")
                
                return result
                
        except asyncio.TimeoutError:
            logger.error(f"Timeout fetching tag: {normalized_tag}")
            result["error"] = "Request timeout"
            return result
        except Exception as e:
            logger.error(f"Error fetching tag {normalized_tag}: {str(e)}")
            result["error"] = str(e)
            return result


# Global instance
proxy = DanbooruProxy()


def register_routes():
    """Register API routes with ComfyUI's PromptServer"""
    
    @PromptServer.instance.routes.get("/api/danbooru/tag/{tag}")
    async def get_tag_info(request):
        tag = request.match_info['tag']
        
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
