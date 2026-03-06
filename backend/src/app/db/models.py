import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    learner_profile: Mapped["LearnerProfile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    course_instances: Mapped[list["CourseInstance"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    agent_logs: Mapped[list["AgentLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class LearnerProfile(Base):
    __tablename__ = "learner_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    experience_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    learning_goals: Mapped[list] = mapped_column(JSONB, default=list)
    interests: Mapped[list] = mapped_column(JSONB, default=list)
    learning_style: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tone_preference: Mapped[str | None] = mapped_column(String(50), nullable=True)
    skill_signals: Mapped[dict] = mapped_column(
        JSONB, default=lambda: {"strengths": [], "gaps": []}
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="learner_profile")

    career_interests: Mapped[list] = mapped_column(JSONB, default=list)
    target_roles: Mapped[list] = mapped_column(JSONB, default=list)
    portfolio_goals: Mapped[list] = mapped_column(JSONB, default=list)

    def to_agent_dict(self) -> dict:
        """Serialize profile fields for agent consumption."""
        return {
            "experience_level": self.experience_level,
            "learning_goals": self.learning_goals,
            "interests": self.interests,
            "learning_style": self.learning_style,
            "tone_preference": self.tone_preference,
            "career_interests": self.career_interests,
            "target_roles": self.target_roles,
            "portfolio_goals": self.portfolio_goals,
        }


class CourseInstance(Base):
    __tablename__ = "course_instances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_course_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    input_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_objectives: Mapped[list] = mapped_column(JSONB, default=list)
    generated_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    lesson_titles: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="course_instances")
    lessons: Mapped[list["Lesson"]] = relationship(
        back_populates="course_instance",
        cascade="all, delete-orphan",
        order_by="Lesson.objective_index",
    )
    assessments: Mapped[list["Assessment"]] = relationship(
        back_populates="course_instance", cascade="all, delete-orphan"
    )
    professional_role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    career_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_portfolio_outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio_artifact_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("portfolio_artifacts.id", ondelete="SET NULL"), nullable=True
    )

    agent_logs: Mapped[list["AgentLog"]] = relationship(
        back_populates="course_instance", cascade="all, delete-orphan"
    )
    portfolio_artifacts: Mapped[list["PortfolioArtifact"]] = relationship(
        back_populates="course_instance", cascade="all, delete-orphan",
        foreign_keys="PortfolioArtifact.course_instance_id",
    )
    portfolio_artifact: Mapped["PortfolioArtifact | None"] = relationship(
        foreign_keys=[portfolio_artifact_id], post_update=True,
    )


class Lesson(Base):
    __tablename__ = "lessons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    course_instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("course_instances.id", ondelete="CASCADE"), nullable=False
    )
    objective_index: Mapped[int] = mapped_column(Integer, nullable=False)
    lesson_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="locked")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    course_instance: Mapped["CourseInstance"] = relationship(back_populates="lessons")
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="lesson", cascade="all, delete-orphan",
        order_by="Activity.activity_index",
    )


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lesson_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False
    )
    activity_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    activity_status: Mapped[str] = mapped_column(String(20), default="pending")
    activity_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    submissions: Mapped[dict] = mapped_column(JSONB, default=list)
    latest_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    latest_feedback: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    mastery_decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    portfolio_artifact_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("portfolio_artifacts.id", ondelete="SET NULL"), nullable=True
    )
    portfolio_readiness: Mapped[str | None] = mapped_column(String(30), nullable=True)
    revision_count: Mapped[int] = mapped_column(Integer, default=0)

    lesson: Mapped["Lesson"] = relationship(back_populates="activities")
    portfolio_artifact: Mapped["PortfolioArtifact | None"] = relationship(
        back_populates="activity", foreign_keys=[portfolio_artifact_id]
    )


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    course_instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("course_instances.id", ondelete="CASCADE"), nullable=False
    )
    assessment_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    submissions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    feedback: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    capstone_artifact_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("portfolio_artifacts.id", ondelete="SET NULL"), nullable=True
    )

    course_instance: Mapped["CourseInstance"] = relationship(back_populates="assessments")
    capstone_artifact: Mapped["PortfolioArtifact | None"] = relationship(
        back_populates="assessment", foreign_keys=[capstone_artifact_id]
    )


class PortfolioArtifact(Base):
    __tablename__ = "portfolio_artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("course_instances.id", ondelete="CASCADE"), nullable=False
    )
    lesson_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True
    )
    artifact_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content_pointer: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    skills: Mapped[list] = mapped_column(JSONB, default=list)
    audience: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employer_use_case: Mapped[str | None] = mapped_column(Text, nullable=True)
    resume_bullet_seed: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship()
    course_instance: Mapped["CourseInstance"] = relationship(
        back_populates="portfolio_artifacts", foreign_keys=[course_instance_id]
    )
    lesson: Mapped["Lesson | None"] = relationship()
    activity: Mapped["Activity | None"] = relationship(
        back_populates="portfolio_artifact", foreign_keys="Activity.portfolio_artifact_id"
    )
    assessment: Mapped["Assessment | None"] = relationship(
        back_populates="capstone_artifact", foreign_keys="Assessment.capstone_artifact_id"
    )


class AgentLog(Base):
    __tablename__ = "agent_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("course_instances.id", ondelete="CASCADE"), nullable=False
    )
    agent_name: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    output: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="agent_logs")
    course_instance: Mapped["CourseInstance"] = relationship(back_populates="agent_logs")
