# Approach Note

## Project Name

College Timetable Generator

## Assignment

Assignment 3 — Intelligent Timetable Generator

## 1. Problem Understanding

A college needs a timetable for different divisions, subjects, teachers,
classrooms, laboratories, days, and periods.

The timetable should not have conflicts. For example:

- A teacher should not teach two divisions at the same time.
- A division should not have two subjects at the same time.
- A room should not be used by two divisions at the same time.
- A laboratory subject should use a laboratory.
- A theory subject should use a classroom.
- Every subject should receive the required number of periods per week.

## 2. Inputs

The administrator provides:

- Working days.
- Time slots and their timings.
- Break or lunch periods.
- Divisions.
- Subjects.
- Weekly workload for each subject.
- Whether a subject is theory or practical.
- Teachers.
- Subjects that each teacher can teach.
- Classrooms.
- Laboratories.

## 3. Workload Assumption

The administrator enters the workload for each subject.

For example:

```text
Mathematics: 4 periods per week
Physics: 3 periods per week
Programming Lab: 2 periods per week
```

The application does not calculate workload from semester duration or
credits because the actual workload is decided by the college curriculum.

In this version, the same subject workload is used for every division.

## 4. Teacher Assignment Assumption

The application does not automatically assign a second teacher just because
there are more teachers than subjects.

The administrator provides the teacher-subject assignment. A teacher can be
assigned to a subject only if the teacher is allowed to teach that subject.

Different divisions can have different teachers for the same subject.

## 5. Application Flow

1. The administrator enters the timetable settings.
2. The administrator adds divisions, subjects, teachers, and rooms.
3. The administrator enters subject workload.
4. The administrator connects teachers with the subjects they can teach.
5. The system checks whether the input is valid.
6. The system generates the timetable.
7. The system checks the generated timetable again.
8. The timetable is shown by division, teacher, or room.

## 6. How the Timetable Is Generated

The application creates separate class sessions from the workload.

For example, if Mathematics requires four periods, the system creates four
Mathematics sessions for that division.

Each session needs:

```text
Division + Subject + Teacher + Room + Day + Period
```

Before placing a session, the system checks:

- The division is free.
- The teacher is free.
- The room is free.
- The room type is correct.
- The selected period is not a break.
- The subject still needs more periods.

If the system cannot place a session, it shows an error instead of returning
an incorrect timetable.

## 7. Main Rules

- A division has only one class in one period.
- A teacher teaches only one class in one period.
- A room hosts only one class in one period.
- Practical subjects use laboratories.
- Theory subjects use classrooms.
- Break periods are not used for classes.
- Each subject receives its required weekly workload.
- Lab periods are consecutive when a lab block is required.

## 8. Handling Impossible Input

The application tells the user when the timetable cannot be generated.

Examples:

- There are not enough periods.
- A subject has no teacher.
- There are not enough laboratories.
- A teacher is required in two places at the same time.
- A subject requires more periods than are available.
- No suitable room is available.

## 9. Technology

- React with Vite for the frontend.
- FastAPI for the backend.
- Supabase PostgreSQL for optional storage.
- Pydantic for input validation.
- Pytest for testing.

Supabase is used to save generated timetables. The application can still
generate a timetable when Supabase is not connected.

## 10. Trade-offs

Supabase makes it possible to save and retrieve timetable data online.
However, it requires extra setup and environment variables.

The scheduling logic is kept in the backend so that the same rules are used
for every request.

The first version focuses on important conflict rules instead of adding
advanced features such as drag-and-drop editing or PDF export.

## 11. Limitations

This version does not include:

- Login and user roles.
- Teacher unavailable periods.
- Teacher preferred periods.
- Manual drag-and-drop timetable editing.
- Lab batches.
- PDF or Excel export.
- Different workloads for every division.
