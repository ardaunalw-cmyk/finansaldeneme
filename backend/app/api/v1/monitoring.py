"""
================================================================================
UTL FİNANS - Monitoring & Telemetry API Endpoints
================================================================================
Role: Senior FinTech Systems Architect & DevOps Engineer
Standards: Prometheus/Grafana Observability, Health & Telemetry Metrics
"""

from typing import Any, List, Dict
from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel

from app.core.cache import cache_service
from app.core.logging_config import telemetry_engine
from app.api.deps import require_roles, get_current_user
from app.models.user import User, UserRole

router = APIRouter(prefix="/monitoring", tags=["System Observability & Monitoring"])


class CachePurgeRequest(BaseModel):
    prefix: str = "alpha:score"


@router.get("/metrics", summary="System Health & Cache Performance Metrics")
async def get_system_metrics() -> Dict[str, Any]:
    """
    Returns real-time system metrics, cache hit rates, active WebSockets, and error counts.
    """
    telemetry = telemetry_engine.get_telemetry_metrics()
    cache_stats = cache_service.get_telemetry()

    return {
        "status": "operational",
        "telemetry": telemetry,
        "cache": cache_stats,
        "environment": "active"
    }


@router.get("/anomalies", summary="Recent Market & System Anomalies")
async def get_recent_anomalies(
    limit: int = Query(default=20, ge=1, le=100)
) -> List[Dict[str, Any]]:
    """
    Returns recent anomalous market swings (>10%), failed API circuits, or dropped WebSockets.
    """
    return telemetry_engine.get_recent_anomalies(limit=limit)


@router.post("/cache/purge", summary="Purge Distributed Cache by Prefix")
async def purge_cache_prefix(
    payload: CachePurgeRequest,
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.PORTFOLIO_MANAGER))
) -> Dict[str, Any]:
    """
    Administrative cache purge for a specific namespace (e.g. 'alpha:score', 'bist:heatmap').
    Restricted to ADMIN and PORTFOLIO_MANAGER roles.
    """
    purged_count = await cache_service.invalidate_prefix(payload.prefix)
    return {
        "status": "success",
        "prefix": payload.prefix,
        "purged_keys_count": purged_count,
        "purged_by": current_user.email
    }

