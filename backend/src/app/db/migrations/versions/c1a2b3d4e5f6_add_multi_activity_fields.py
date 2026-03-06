"""add multi-activity fields to activities table

Revision ID: c1a2b3d4e5f6
Revises: 68259462e2ea
Create Date: 2026-03-06 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, None] = "68259462e2ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("activity_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "activities",
        sa.Column("activity_status", sa.String(20), nullable=False, server_default="pending"),
    )
    # Migrate existing data: set completed where mastery_decision exists
    op.execute(
        "UPDATE activities SET activity_status = 'completed' WHERE mastery_decision IS NOT NULL"
    )
    op.execute(
        "UPDATE activities SET activity_status = 'active' WHERE mastery_decision IS NULL"
    )


def downgrade() -> None:
    op.drop_column("activities", "activity_status")
    op.drop_column("activities", "activity_index")
