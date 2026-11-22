"""Add effective production assumptions and investment basis."""
from alembic import op
import sqlalchemy as sa

revision = "0002_oee_seasonality_capex"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _columns():
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("studies")}


def upgrade():
    # 0001 creates tables from SQLAlchemy metadata. The metadata now has these
    # columns for fresh installs; existing installations receive them here.
    columns = _columns()
    if "oee_pct" not in columns:
        op.add_column("studies", sa.Column("oee_pct", sa.Numeric(5, 2), nullable=False, server_default="100"))
    if "seasonality_pct" not in columns:
        op.add_column("studies", sa.Column("seasonality_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
    if "capex" not in columns:
        op.add_column("studies", sa.Column("capex", sa.Numeric(14, 2), nullable=False, server_default="0"))


def downgrade():
    columns = _columns()
    for name in ("capex", "seasonality_pct", "oee_pct"):
        if name in columns:
            op.drop_column("studies", name)
