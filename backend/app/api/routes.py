"""API router: POST /api/simulate and GET /api/health."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..core.experiment import run_experiment

MAX_PHOTONS = 4096
MAX_MESSAGE_BYTES = 512


class ValidationError(ValueError):
    """Raised when incoming simulation request parameters fail validation."""


def validate_simulate_payload(raw: Any) -> dict[str, Any]:
    """Validate and normalize a simulation request payload (Pydantic-equivalent)."""
    if not isinstance(raw, dict):
        raise ValidationError("Request body must be a JSON object.")

    n_photons = raw.get("n_photons", 256)
    if isinstance(n_photons, bool) or not isinstance(n_photons, int):
        raise ValidationError("n_photons must be an integer.")
    if n_photons < 8 or n_photons > MAX_PHOTONS:
        raise ValidationError(f"n_photons must be between 8 and {MAX_PHOTONS}.")

    eve_enabled = raw.get("eve_enabled", False)
    if not isinstance(eve_enabled, bool):
        raise ValidationError("eve_enabled must be a boolean.")

    def _rate(field_name: str, default: float) -> float:
        val = raw.get(field_name, default)
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            raise ValidationError(f"{field_name} must be a number.")
        fval = float(val)
        if fval < 0.0 or fval > 1.0:
            raise ValidationError(f"{field_name} must be between 0.0 and 1.0.")
        return fval

    interception_rate = _rate("interception_rate", 1.0)
    noise_rate = _rate("noise_rate", 0.0)
    sample_fraction = _rate("sample_fraction", 0.25)

    threshold_raw = raw.get("threshold", 0.11)
    if isinstance(threshold_raw, bool) or not isinstance(threshold_raw, (int, float)):
        raise ValidationError("threshold must be a number.")
    threshold = float(threshold_raw)
    if threshold <= 0.0 or threshold > 1.0:
        raise ValidationError("threshold must be in (0.0, 1.0].")

    message = raw.get("message", None)
    if message is not None:
        if not isinstance(message, str):
            raise ValidationError("message must be a string or null.")
        if len(message) > 2048 or len(message.encode("utf-8")) > MAX_MESSAGE_BYTES:
            raise ValidationError(
                f"message must be at most {MAX_MESSAGE_BYTES} UTF-8 bytes"
            )

    seed = raw.get("seed", None)
    if seed is not None:
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValidationError("seed must be an integer or null.")
        if seed < 0 or seed > 2**32 - 1:
            raise ValidationError("seed must be between 0 and 2^32 - 1.")

    return {
        "n_photons": n_photons,
        "eve_enabled": eve_enabled,
        "interception_rate": interception_rate,
        "noise_rate": noise_rate,
        "sample_fraction": sample_fraction,
        "threshold": threshold,
        "message": message,
        "seed": seed,
    }


try:
    from fastapi import APIRouter
    from pydantic import BaseModel, Field, field_validator

    router = APIRouter(prefix="/api")

    class SimulateRequest(BaseModel):
        n_photons: int = Field(
            default=256, ge=8, le=MAX_PHOTONS,
            description="Number of photons Alice sends (8-4096).",
        )
        eve_enabled: bool = Field(
            default=False, description="Enable Eve's intercept-resend attack."
        )
        interception_rate: float = Field(
            default=1.0, ge=0.0, le=1.0,
            description="Probability that Eve intercepts each photon.",
        )
        noise_rate: float = Field(
            default=0.0, ge=0.0, le=1.0,
            description="Probability of a bit-flip channel error per photon.",
        )
        sample_fraction: float = Field(
            default=0.25, ge=0.0, le=1.0,
            description="Fraction of the sifted key revealed for QBER estimation.",
        )
        threshold: float = Field(
            default=0.11, gt=0.0, le=1.0,
            description="Educational abort threshold on the observed QBER.",
        )
        message: str | None = Field(
            default=None, max_length=2048,
            description="Optional plaintext for the one-time-pad demonstration.",
        )
        seed: int | None = Field(
            default=None, ge=0, le=2**32 - 1,
            description="Optional deterministic seed for reproducible runs.",
        )

        @field_validator("message")
        @classmethod
        def message_size(cls, v: str | None) -> str | None:
            if v is not None and len(v.encode("utf-8")) > MAX_MESSAGE_BYTES:
                raise ValueError(
                    f"message must be at most {MAX_MESSAGE_BYTES} UTF-8 bytes")
            return v

    @router.get("/health")
    def health() -> dict:
        return {"status": "ok", "service": "bb84-api", "version": "1.0.0"}

    @router.post("/simulate")
    def simulate(req: SimulateRequest) -> dict:
        """Run one full BB84 experiment and return the complete result."""
        return run_experiment(
            n_photons=req.n_photons,
            eve_enabled=req.eve_enabled,
            interception_rate=req.interception_rate,
            noise_rate=req.noise_rate,
            sample_fraction=req.sample_fraction,
            threshold=req.threshold,
            message=req.message,
            seed=req.seed,
        )

except ImportError:
    router = None  # type: ignore[assignment]

    @dataclass
    class SimulateRequest:  # type: ignore[no-redef]
        n_photons: int = 256
        eve_enabled: bool = False
        interception_rate: float = 1.0
        noise_rate: float = 0.0
        sample_fraction: float = 0.25
        threshold: float = 0.11
        message: str | None = None
        seed: int | None = None

        @classmethod
        def from_dict(cls, raw: Any) -> "SimulateRequest":
            validated = validate_simulate_payload(raw)
            return cls(**validated)

    def health() -> dict:
        return {"status": "ok", "service": "bb84-api", "version": "1.0.0"}

    def simulate(req: SimulateRequest | dict[str, Any]) -> dict:
        """Run one full BB84 experiment and return the complete result."""
        if isinstance(req, dict):
            req = SimulateRequest.from_dict(req)
        return run_experiment(
            n_photons=req.n_photons,
            eve_enabled=req.eve_enabled,
            interception_rate=req.interception_rate,
            noise_rate=req.noise_rate,
            sample_fraction=req.sample_fraction,
            threshold=req.threshold,
            message=req.message,
            seed=req.seed,
        )

