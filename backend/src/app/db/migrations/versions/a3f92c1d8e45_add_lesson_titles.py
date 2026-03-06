"""add lesson_titles to course_instances

Revision ID: a3f92c1d8e45
Revises: 1c86f25998a1
Create Date: 2026-03-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a3f92c1d8e45'
down_revision = '1c86f25998a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'course_instances',
        sa.Column('lesson_titles', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('course_instances', 'lesson_titles')
