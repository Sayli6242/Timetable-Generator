"""Request / response models shared by the API, the solver and the verifier."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class SubjectType(str, Enum):
    THEORY = "THEORY"
    LAB = "LAB"
    THEORY_AND_LAB = "THEORY_AND_LAB"  # has both theory periods (classroom) and lab periods (lab room)


class RoomType(str, Enum):
    CLASSROOM = "CLASSROOM"
    LAB = "LAB"


# A theory subject must sit in a classroom, a lab subject in a laboratory.
REQUIRED_ROOM = {SubjectType.THEORY: RoomType.CLASSROOM, SubjectType.LAB: RoomType.LAB}


class Subject(BaseModel):
    name: str = Field(min_length=1)
    type: SubjectType = SubjectType.THEORY
    weekly_workload: int = Field(ge=1, le=40, description="Periods per week for each division")
    # Labs are taught in blocks of consecutive periods (e.g. a 2-hour practical).
    block_length: int = Field(default=1, ge=1, le=4)
    # Only for THEORY_AND_LAB: separate period counts for each component.
    theory_workload: Optional[int] = Field(default=None, ge=1)
    lab_workload: Optional[int] = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @property
    def effective_block(self) -> int:
        return self.block_length if self.type == SubjectType.LAB else 1


class Room(BaseModel):
    name: str = Field(min_length=1)
    type: RoomType = RoomType.CLASSROOM


class Teacher(BaseModel):
    name: str = Field(min_length=1)
    subjects: list[str] = Field(default_factory=list, description="Subjects this teacher can teach")
    max_periods_per_day: Optional[int] = Field(default=None, ge=1)


class Division(BaseModel):
    name: str = Field(min_length=1)
    # Optional: restrict which subjects this division takes. Empty = all subjects.
    subjects: list[str] = Field(default_factory=list)


class Assignment(BaseModel):
    """Optional fixed choice of teacher for a division-subject pair."""
    division: str
    subject: str
    teacher: str


class SolverOptions(BaseModel):
    seed: int = 7
    time_limit_seconds: float = Field(default=20.0, gt=0, le=120)


class TimetableInput(BaseModel):
    name: str = "Untitled timetable"
    working_days: list[str] = Field(min_length=1)
    periods_per_day: int = Field(ge=1, le=16)
    # Clock times for the working day, e.g. "08:00", "10:30", "11:00", "17:00".
    day_start: Optional[str] = None
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    day_end: Optional[str] = None
    # One or more lunch/tea breaks (e.g. [4] or [2, 5]).  Lab blocks may not cross any break.
    break_after_periods: list[int] = Field(default_factory=list)
    subjects: list[Subject] = Field(min_length=1)
    rooms: list[Room] = Field(min_length=1)
    teachers: list[Teacher] = Field(min_length=1)
    divisions: list[Division] = Field(min_length=1)
    assignments: list[Assignment] = Field(default_factory=list)
    options: SolverOptions = Field(default_factory=SolverOptions)


class Entry(BaseModel):
    division: str
    day: str
    period: int  # 1-based
    subject: str
    subject_type: SubjectType
    teacher: str
    room: str
    block_id: int  # periods belonging to the same lab block share an id


class Issue(BaseModel):
    code: str
    message: str


class GenerateResult(BaseModel):
    status: str  # "ok" | "infeasible" | "invalid"
    entries: list[Entry] = Field(default_factory=list)
    teacher_assignments: list[Assignment] = Field(default_factory=list)
    errors: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    verification: list[Issue] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)
