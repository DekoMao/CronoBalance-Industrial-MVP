import os
import json
from functools import lru_cache
from urllib.request import urlopen
from dataclasses import dataclass
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .db.models import Membership, User
from .db.session import get_db


@lru_cache(maxsize=16)
def jwks_client_for(issuer: str, configured_url: str):
    from jwt import PyJWKClient
    jwks_url=configured_url
    if not jwks_url:
        with urlopen(f"{issuer}/.well-known/openid-configuration",timeout=5) as response:
            metadata=json.loads(response.read().decode("utf-8"))
        jwks_url=metadata.get("jwks_uri","")
    if not jwks_url: raise ValueError("Discovery OIDC não informou jwks_uri")
    return PyJWKClient(jwks_url,cache_keys=True)

bearer = HTTPBearer(auto_error=False)


@dataclass
class Actor:
    user: User
    organization_id: str
    role: str


def actor_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    organization_header: str | None = Header(default=None, alias="X-Organization-ID"),
    db: Session = Depends(get_db),
) -> Actor:
    app_env = os.getenv("APP_ENV", "development")
    dev_token = os.getenv("DEV_AUTH_TOKEN", "")
    if app_env == "development" and dev_token and credentials and credentials.credentials == dev_token:
        user = db.query(User).filter_by(oidc_subject="local-dev").first()
        membership = db.query(Membership).filter_by(user_id=user.id).first() if user else None
    else:
        issuer = os.getenv("OIDC_ISSUER", "").rstrip("/")
        audience = os.getenv("OIDC_AUDIENCE", "")
        jwks_url=os.getenv("OIDC_JWKS_URL","")
        if not (credentials and issuer and audience):
            raise HTTPException(401, "Autenticação OIDC não configurada")
        try:
            from jwt import decode
            jwks = jwks_client_for(issuer,jwks_url)
            signing_key = jwks.get_signing_key_from_jwt(credentials.credentials)
            claims = decode(credentials.credentials, signing_key.key, algorithms=["RS256", "ES256"], audience=audience, issuer=issuer)
        except Exception as exc:
            raise HTTPException(401, "Token OIDC inválido") from exc
        user = db.query(User).filter_by(oidc_subject=claims["sub"], active=True).first()
        if not user:
            raise HTTPException(403, "Usuário sem provisionamento nesta organização")
        memberships = db.query(Membership).filter_by(user_id=user.id).all()
        if organization_header:
            membership = next((m for m in memberships if m.organization_id == organization_header), None)
        elif len(memberships) == 1:
            membership = memberships[0]
        else:
            raise HTTPException(400, "Informe X-Organization-ID para selecionar a organização")
    if not user or not membership:
        raise HTTPException(401, "Sessão local indisponível; verifique a configuração de desenvolvimento")
    return Actor(user=user, organization_id=membership.organization_id, role=membership.role)


def require_role(*roles: str):
    def check(actor: Actor = Depends(actor_context)) -> Actor:
        if actor.role not in roles:
            raise HTTPException(403, "Seu perfil não pode executar esta ação")
        return actor
    return check
