"""Ranked model preferences for each connection."""

import sqlalchemy as sa
from alembic import op

revision = "c3101d"
down_revision = "a481c6e724df"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "providers", sa.Column("preferred_models", sa.JSON(), nullable=False, server_default="[]")
    )
    op.add_column(
        "providers",
        sa.Column("preferred_only", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("providers", "preferred_only")
    op.drop_column("providers", "preferred_models")
