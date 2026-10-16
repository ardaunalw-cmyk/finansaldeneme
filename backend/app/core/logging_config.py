"""
================================================================================
UTL FİNANS - Enterprise Structured Logging & Anomaly Monitoring Architecture
================================================================================
Role: Senior FinTech Systems Architect & DevOps Engineer
Standards: Structured JSON Logging (12-Factor App), Request Tracing (OpenTelemetry)

ARCHITECTURAL BOTTLENECK ANALYSIS:
--------------------------------------------------------------------------------
1. BOTTLENECK: Disk I/O Blocking from Synchronous High-Frequency Logging
   - Risk: In high-frequency market streaming (hundreds of ticks/sec across BIST 100),
     synchronous logging directly to disk halts Python execution threads, inducing
     significant latency jitter.
   - Mitigation:
     a) Asynchronous, non-blocking log sink using Loguru's enqueue=True (background
        thread queue).
     b) Filter low-value tick logs from disk while maintaining full stdout stream for
        container log collectors (e.g., FluentBit, Promtail).
     c) Circular in-memory anomaly ring buffer for fast diagnostic queries without
        touching disk storage.
================================================================================
"""

import sys
import time
import uuid
import logging
from typing import Callable, Dict, Any, List
from collections import deque
from datetime import datetime, timezone
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from loguru import logger

from app.core.config import settings


# ==============================================================================
# Intercept Standard Library Logging & Direct to Loguru
# ==============================================================================
class InterceptHandler(logging.Handler):
    """
    Redirects standard library logs (uvicorn, fastapi, sqlalchemy) to Loguru
    for unified structured processing.
    """
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame.f_back and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level,
            record.getMessage()
        )


def setup_enterprise_logging() -> None:
    """Configures structured enterprise logging with async file rotation."""
    # Remove default handlers
    logger.remove()

    # 1. Console Output (Colorized for developer clarity)
    log_format = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{extra[request_id]}</cyan> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>"
    )

    logger.add(
        sys.stdout,
        format=log_format,
        level="INFO" if settings.ENVIRONMENT == "production" else "DEBUG",
        colorize=True,
        enqueue=True  # Non-blocking async queue
    )

    # 2. Persistent JSON File Sink for Log Aggregation (ELK / Loki)
    logger.add(
        "logs/utl_engine_{time:YYYY-MM-DD}.log",
        rotation="50 MB",
        retention="14 days",
        compression="zip",
        serialize=True,  # Outputs structured JSON
        level="INFO",
        enqueue=True
    )

    # Configure stdlib logging redirection
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    for uvicorn_logger in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logging.getLogger(uvicorn_logger).handlers = [InterceptHandler()]


# ==============================================================================
# Anomaly Detection & Telemetry Tracker
# ==============================================================================
class AnomalyTelemetryEngine:
    """
    Detects and records market anomalies, API error spikes, and WebSocket dropouts.
    Maintains a ring buffer of recent diagnostic incidents.
    """
    def __init__(self, max_buffer_size: int = 1000):
        self._anomalies: deque = deque(maxlen=max_buffer_size)
        self._ws_connections_count: int = 0
        self._ws_disconnect_count: int = 0
        self._api_error_counts: Dict[str, int] = {"4xx": 0, "5xx": 0}

    def record_market_anomaly(self, ticker: str, reason: str, details: Dict[str, Any]) -> None:
        """Records abnormal price swings, flash moves, or circuit breaker trips."""
        incident = {
            "id": str(uuid.uuid4()),
            "type": "MARKET_ANOMALY",
            "ticker": ticker,
            "reason": reason,
            "details": details,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self._anomalies.append(incident)
        logger.warning(
            "MARKET ANOMALY DETECTED: [{}] {} - Details: {}",
            ticker, reason, details
        )

    def record_ws_connect(self, client_id: str) -> None:
        """Increments active WebSocket connection count."""
        self._ws_connections_count += 1
        logger.debug("WebSocket Connected: {} (Active: {})", client_id, self._ws_connections_count)

    def record_ws_disconnect(self, client_id: str, code: int, reason: str) -> None:
        """Tracks WebSocket disconnections and anomalous dropped sessions."""
        self._ws_connections_count = max(0, self._ws_connections_count - 1)
        self._ws_disconnect_count += 1

        is_abnormal = code not in (1000, 1001)  # 1000=Normal, 1001=Going Away
        log_level = logger.warning if is_abnormal else logger.debug

        incident = {
            "id": str(uuid.uuid4()),
            "type": "WEBSOCKET_DROP" if is_abnormal else "WEBSOCKET_DISCONNECT",
            "client_id": client_id,
            "code": code,
            "reason": reason or "Client closed connection",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if is_abnormal:
            self._anomalies.append(incident)

        log_level(
            "WebSocket Disconnect: {} | Code: {} | Reason: {} | Active: {}",
            client_id, code, reason, self._ws_connections_count
        )

    def record_http_error(self, status_code: int, path: str, method: str) -> None:
        """Tracks API error frequencies."""
        if 400 <= status_code < 500:
            self._api_error_counts["4xx"] += 1
        elif status_code >= 500:
            self._api_error_counts["5xx"] += 1
            incident = {
                "id": str(uuid.uuid4()),
                "type": "API_SERVER_ERROR",
                "status_code": status_code,
                "path": path,
                "method": method,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            self._anomalies.append(incident)

    def get_recent_anomalies(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Returns recent recorded anomalies."""
        items = list(self._anomalies)
        return items[-limit:]

    def get_telemetry_metrics(self) -> Dict[str, Any]:
        """Provides overall health and resilience telemetry."""
        return {
            "active_ws_clients": self._ws_connections_count,
            "total_ws_disconnects": self._ws_disconnect_count,
            "total_4xx_errors": self._api_error_counts["4xx"],
            "total_5xx_errors": self._api_error_counts["5xx"],
            "total_recorded_anomalies": len(self._anomalies)
        }


# Global Telemetry Singleton
telemetry_engine = AnomalyTelemetryEngine()


# ==============================================================================
# Enterprise Request Tracing Middleware (X-Request-ID & Latency Monitoring)
# ==============================================================================
class RequestTracingMiddleware(BaseHTTPMiddleware):
    """
    Injects unique correlation X-Request-ID, tracks endpoint response latency,
    and logs request lifecycles.
    """
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Extract or generate correlation ID
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        start_time = time.perf_counter()

        with logger.contextualize(request_id=request_id):
            try:
                response = await call_next(request)
                latency_ms = (time.perf_counter() - start_time) * 1000.0

                # Append correlation headers to response
                response.headers["X-Request-ID"] = request_id
                response.headers["X-Response-Time-MS"] = f"{latency_ms:.2f}"

                # Telemetry tracking for errors
                if response.status_code >= 400:
                    telemetry_engine.record_http_error(
                        response.status_code,
                        request.url.path,
                        request.method
                    )

                # Log performance degradation if endpoint exceeds 500ms
                if latency_ms > 500.0 and not request.url.path.startswith("/docs"):
                    logger.warning(
                        "High Latency Detected: {} {} took {:.2f}ms (Status: {})",
                        request.method, request.url.path, latency_ms, response.status_code
                    )
                else:
                    logger.info(
                        "{} {} -> {} ({:.2f}ms)",
                        request.method, request.url.path, response.status_code, latency_ms
                    )

                return response

            except Exception as exc:
                latency_ms = (time.perf_counter() - start_time) * 1000.0
                telemetry_engine.record_http_error(500, request.url.path, request.method)
                logger.exception(
                    "Unhandled Exception in {} {} ({:.2f}ms): {}",
                    request.method, request.url.path, latency_ms, exc
                )
                raise

