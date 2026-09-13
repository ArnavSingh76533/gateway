"""Restricted administration and explicitly published community models."""

import sqlalchemy as sa
from alembic import op

revision = "a481c6e724df"
down_revision = "36bb49c6546c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users", sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    op.add_column(
        "users", sa.Column("disabled", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    op.add_column("request_logs", sa.Column("sponsored_cost", sa.Float(), nullable=True))
    op.create_table(
        "site_configuration",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("settings", sa.JSON(), nullable=False),
    )
    op.create_table(
        "published_models",
        sa.Column(
            "model_id",
            sa.String(36),
            sa.ForeignKey("registry_models.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("requests_per_minute", sa.Integer(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )


def downgrade():
    op.drop_table("published_models")
    op.drop_table("site_configuration")
    op.drop_column("request_logs", "sponsored_cost")
    op.drop_column("users", "disabled")
    op.drop_column("users", "is_admin")
