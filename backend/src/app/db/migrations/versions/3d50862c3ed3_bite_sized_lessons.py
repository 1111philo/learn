"""bite_sized_lessons

Revision ID: 3d50862c3ed3
Revises: 1c86f25998a1
Create Date: 2026-03-03 16:39:58.509273

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '3d50862c3ed3'
down_revision: Union[str, Sequence[str], None] = '1c86f25998a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # lessons: sub_lesson_index, lesson_role, lesson_title
    op.add_column('lessons', sa.Column(
        'sub_lesson_index', sa.Integer(), nullable=False, server_default='0'
    ))
    op.add_column('lessons', sa.Column(
        'lesson_role', sa.String(20), nullable=False, server_default='capstone'
    ))
    op.add_column('lessons', sa.Column(
        'lesson_title', sa.String(200), nullable=True
    ))

    # course_instances: diagnostic columns
    op.add_column('course_instances', sa.Column(
        'diagnostic_spec',
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    ))
    op.add_column('course_instances', sa.Column(
        'diagnostic_responses',
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    ))
    op.add_column('course_instances', sa.Column(
        'diagnostic_analysis',
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    ))


def downgrade() -> None:
    op.drop_column('course_instances', 'diagnostic_analysis')
    op.drop_column('course_instances', 'diagnostic_responses')
    op.drop_column('course_instances', 'diagnostic_spec')
    op.drop_column('lessons', 'lesson_title')
    op.drop_column('lessons', 'lesson_role')
    op.drop_column('lessons', 'sub_lesson_index')
