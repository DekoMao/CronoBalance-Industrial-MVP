"""User-facing revision and measurement context."""
from alembic import op
import sqlalchemy as sa

revision = "0003_workspace"
down_revision = "0002_oee_seasonality_capex"
branch_labels = None
depends_on = None

def upgrade():
    if "workspace_metadata" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("studies")}:
        op.add_column("studies", sa.Column("workspace_metadata", sa.JSON(), nullable=True))

def downgrade():
    op.drop_column("studies", "workspace_metadata")
