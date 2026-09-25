# Validation and Test Details

## Purpose

This document explains how the timetable generator was tested.

## 1. Valid Timetable

### Test

1. Select Monday to Friday.
2. Add periods for each day.
3. Add divisions.
4. Add subjects.
5. Add weekly workload.
6. Add teachers.
7. Add classrooms and laboratories.
8. Generate the timetable.

### Expected Result

The timetable is generated successfully and all required subjects are
included.

## 2. Division Conflict

### Test

Try to assign two subjects to the same division on the same day and period.

### Expected Result

The application does not allow two classes for the same division at the same
time.

## 3. Teacher Conflict

### Test

Try to assign the same teacher to two divisions during the same period.

### Expected Result

The application detects the conflict and does not accept the timetable.

## 4. Room Conflict

### Test

Try to assign the same room to two divisions during the same period.

### Expected Result

The application detects the conflict and does not accept the timetable.

## 5. Laboratory Requirement

### Test

Add a practical subject and provide a laboratory.

### Expected Result

The practical subject is assigned only to a laboratory.

## 6. No Laboratory Available

### Test

Add a practical subject but do not add any laboratory.

### Expected Result

The application shows that a suitable laboratory is not available.

## 7. Theory Room Requirement

### Test

Add a theory subject and provide classrooms.

### Expected Result

The theory subject is assigned to a classroom, not a laboratory.

## 8. Break Period

### Test

Add a lunch or break period.

### Expected Result

No class is assigned during the break.

## 9. Subject Workload

### Test

Set Mathematics workload to four periods per week.

### Expected Result

Mathematics appears exactly four times for the division.

## 10. Missing Teacher

### Test

Add a subject without assigning a suitable teacher.

### Expected Result

The application shows an error and does not generate an invalid timetable.

## 11. Too Much Workload

### Test

Set the total workload higher than the available periods.

### Expected Result

The application explains that there are not enough periods.

## 12. Teacher Can Teach Only Selected Subjects

### Test

Assign a teacher to Mathematics only, then try to use that teacher for
Physics.

### Expected Result

The application does not allow the incorrect assignment.

## 13. Multiple Teachers

### Test

Add more teachers than subjects.

### Expected Result

The application does not automatically assign two teachers to every
subject. Teachers are assigned only according to the administrator's input.

## 14. Result Verification

After generation, the application checks the timetable again.

It verifies:

- Division conflicts.
- Teacher conflicts.
- Room conflicts.
- Room type.
- Break periods.
- Subject workload.

If any problem is found, the timetable is not shown as valid.
