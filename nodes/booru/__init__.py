"""
Booru API proxy for ComfyUI.
Backend endpoints that fetch tag/post/wiki data from multiple booru sites,
handling CORS, caching, rate limiting and blocked-User-Agent rotation.
"""

from .proxy import register_routes

__all__ = ["register_routes"]

register_routes()
