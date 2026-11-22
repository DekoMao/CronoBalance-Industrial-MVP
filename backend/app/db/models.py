from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, Numeric, String, Text, UniqueConstraint, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .session import Base


def utcnow(): return datetime.now(timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    memberships = relationship("Membership", back_populates="organization", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    oidc_subject: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")


class Membership(Base):
    __tablename__ = "organization_memberships"
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="engineer")
    organization = relationship("Organization", back_populates="memberships")
    user = relationship("User", back_populates="memberships")
    __table_args__ = (CheckConstraint("role in ('admin','engineer','viewer')"),)


class Study(Base):
    __tablename__ = "studies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    product_family: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    shift_seconds: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    demand_per_shift: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    productive_days_per_month: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    baseline_units_per_day: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    labor_cost_current: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    labor_cost_future: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    current_station_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    future_station_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    areas = relationship("Area", cascade="all, delete-orphan", order_by="Area.sort_order")
    elements = relationship("WorkElement", cascade="all, delete-orphan", order_by="WorkElement.sort_order")
    stations = relationship("Station", cascade="all, delete-orphan", order_by="Station.scenario, Station.station_index")
    precedences = relationship("Precedence", cascade="all, delete-orphan")
    __table_args__ = (
        CheckConstraint("shift_seconds > 0"), CheckConstraint("demand_per_shift >= 0"),
        CheckConstraint("productive_days_per_month between 0 and 31"),
        CheckConstraint("current_station_count between 1 and 100"), CheckConstraint("future_station_count between 1 and 100"),
    )


class Area(Base):
    __tablename__ = "areas"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    operational_cost_current: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    operational_cost_future: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    __table_args__ = (UniqueConstraint("study_id", "id"), CheckConstraint("operational_cost_current >= 0"), CheckConstraint("operational_cost_future >= 0"))


class EquipmentResource(Base):
    __tablename__ = "equipment_resources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    current_station_index: Mapped[int | None] = mapped_column(Integer)
    future_station_index: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("study_id", "id"),)


class Station(Base):
    __tablename__ = "line_stations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    scenario: Mapped[str] = mapped_column(String(10), nullable=False)
    station_index: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    fixed_equipment_id: Mapped[str | None] = mapped_column(String(36))
    __table_args__ = (
        UniqueConstraint("study_id", "scenario", "station_index"), UniqueConstraint("study_id", "scenario", "id"),
        CheckConstraint("scenario in ('current','future')"),
        ForeignKeyConstraint(["study_id", "fixed_equipment_id"], ["equipment_resources.study_id", "equipment_resources.id"], ondelete="RESTRICT"),
    )


class WorkElement(Base):
    __tablename__ = "work_elements"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    area_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_va_seconds: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    current_nva_seconds: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    future_va_seconds: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    future_nva_seconds: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    fixed_equipment_id: Mapped[str | None] = mapped_column(String(36))
    ergonomic_zone: Mapped[str | None] = mapped_column(String(10))
    ergonomic_exception: Mapped[dict | None] = mapped_column(JSON)
    validation_status: Mapped[str] = mapped_column(String(20), default="hypothesis", nullable=False)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    evidence_ref: Mapped[str | None] = mapped_column(String(500))
    __table_args__ = (
        UniqueConstraint("study_id", "id"),
        ForeignKeyConstraint(["study_id", "area_id"], ["areas.study_id", "areas.id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["study_id", "fixed_equipment_id"], ["equipment_resources.study_id", "equipment_resources.id"], ondelete="RESTRICT"),
        CheckConstraint("current_va_seconds >= 0 and current_nva_seconds >= 0 and future_va_seconds >= 0 and future_nva_seconds >= 0"),
        CheckConstraint("ergonomic_zone is null or ergonomic_zone in ('green','yellow','red')"),
    )


class ElementAssignment(Base):
    __tablename__ = "element_assignments"
    study_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    element_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scenario: Mapped[str] = mapped_column(String(10), primary_key=True)
    station_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sequence_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["study_id", "element_id"], ["work_elements.study_id", "work_elements.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["study_id", "scenario", "station_id"], ["line_stations.study_id", "line_stations.scenario", "line_stations.id"], ondelete="RESTRICT"),
        CheckConstraint("scenario in ('current','future')"), CheckConstraint("sequence_order >= 1"),
    )


class Precedence(Base):
    __tablename__ = "element_precedences"
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), primary_key=True)
    predecessor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    successor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["study_id", "predecessor_id"], ["work_elements.study_id", "work_elements.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["study_id", "successor_id"], ["work_elements.study_id", "work_elements.id"], ondelete="CASCADE"),
        CheckConstraint("predecessor_id <> successor_id"),
    )


class Revision(Base):
    __tablename__ = "study_revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="RESTRICT"), nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    change_summary: Mapped[str] = mapped_column(String(500), nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    __table_args__ = (UniqueConstraint("study_id", "revision_number"), UniqueConstraint("study_id", "source_version"))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False, index=True)
    study_id: Mapped[str | None] = mapped_column(ForeignKey("studies.id", ondelete="RESTRICT"))
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(36))
    before_data: Mapped[dict | None] = mapped_column(JSON)
    after_data: Mapped[dict | None] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str] = mapped_column(String(100), nullable=False)
    client_mutation_id: Mapped[str | None] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class MutationReceipt(Base):
    __tablename__ = "mutation_receipts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    client_mutation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)
    __table_args__ = (UniqueConstraint("study_id", "client_mutation_id"),)
