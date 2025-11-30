export class ScheduleDto {
  day: string;
  beginTime: string;
  endTime: string;
  classroom: number;
  building: number;
}

export class GroupDto {
  subjectGroupId: number;
  spots: number;
  group: string;
  teacher: string;
  schedules: ScheduleDto[];
}

export class SubjectGroupResponseDto {
  planSubjectId: number;
  groups: GroupDto[];
}