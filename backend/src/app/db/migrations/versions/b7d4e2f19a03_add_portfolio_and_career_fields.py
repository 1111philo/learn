"""add portfolio artifacts table and career/portfolio fields

Revision ID: b7d4e2f19a03
Revises: a3f92c1d8e45
Create Date: 2026-03-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b7d4e2f19a03'
down_revision = 'a3f92c1d8e45'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create portfolio_artifacts table
    op.create_table(
        'portfolio_artifacts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_instance_id', sa.String(36), sa.ForeignKey('course_instances.id', ondelete='CASCADE'), nullable=False),
        sa.Column('lesson_id', sa.String(36), sa.ForeignKey('lessons.id', ondelete='SET NULL'), nullable=True),
        sa.Column('artifact_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('content_pointer', sa.Text(), nullable=True),
        sa.Column('status', sa.String(30), server_default='draft', nullable=False),
        sa.Column('skills', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
        sa.Column('audience', sa.String(255), nullable=True),
        sa.Column('employer_use_case', sa.Text(), nullable=True),
        sa.Column('resume_bullet_seed', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Extend course_instances
    op.add_column('course_instances', sa.Column('professional_role', sa.String(255), nullable=True))
    op.add_column('course_instances', sa.Column('career_context', sa.Text(), nullable=True))
    op.add_column('course_instances', sa.Column('final_portfolio_outcome', sa.Text(), nullable=True))

    # Extend activities
    op.add_column('activities', sa.Column('portfolio_artifact_id', sa.String(36), sa.ForeignKey('portfolio_artifacts.id', ondelete='SET NULL'), nullable=True))
    op.add_column('activities', sa.Column('portfolio_readiness', sa.String(30), nullable=True))
    op.add_column('activities', sa.Column('revision_count', sa.Integer(), server_default='0', nullable=False))

    # Extend assessments
    op.add_column('assessments', sa.Column('capstone_artifact_id', sa.String(36), sa.ForeignKey('portfolio_artifacts.id', ondelete='SET NULL'), nullable=True))

    # Extend learner_profiles
    op.add_column('learner_profiles', sa.Column('career_interests', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('learner_profiles', sa.Column('target_roles', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('learner_profiles', sa.Column('portfolio_goals', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    # Reverse learner_profiles
    op.drop_column('learner_profiles', 'portfolio_goals')
    op.drop_column('learner_profiles', 'target_roles')
    op.drop_column('learner_profiles', 'career_interests')

    # Reverse assessments
    op.drop_column('assessments', 'capstone_artifact_id')

    # Reverse activities
    op.drop_column('activities', 'revision_count')
    op.drop_column('activities', 'portfolio_readiness')
    op.drop_column('activities', 'portfolio_artifact_id')

    # Reverse course_instances
    op.drop_column('course_instances', 'final_portfolio_outcome')
    op.drop_column('course_instances', 'career_context')
    op.drop_column('course_instances', 'professional_role')

    # Drop portfolio_artifacts table
    op.drop_table('portfolio_artifacts')
