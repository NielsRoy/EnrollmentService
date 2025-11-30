import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubjectGroup } from '../entities/subject-group.entity';
import { GroupDto, ScheduleDto, SubjectGroupResponseDto } from '../dto/responses/subject-group.response.dto';

@Injectable()
export class SubjectGroupService {

    constructor(
        @InjectRepository(SubjectGroup)
        private readonly subjectGroupRepository: Repository<SubjectGroup>,
    ) { }

    /**
     * Get all subject groups with schedules for a list of plan subject IDs
     * @param planSubjectIds - Array of plan subject IDs
     * @returns Array of subject groups grouped by plan subject ID with schedules, teacher, classroom, and building info
     */
    async getSubjectGroupsByPlanSubjectIds(planSubjectIds: number[]): Promise<SubjectGroupResponseDto[]> {
        if (planSubjectIds.length === 0) {
            return [];
        }

        // Query to get all subject groups with their schedules, classrooms, buildings, and teachers
        const results = await this.subjectGroupRepository.createQueryBuilder("subjectGroup")
            .leftJoinAndSelect("subjectGroup.teacher", "teacher")
            .leftJoin("group_schedule", "gs", "gs.subjectGroupId = subjectGroup.id")
            .leftJoin("schedule", "schedule", "schedule.id = gs.scheduleId")
            .leftJoin("classroom", "classroom", "classroom.id = gs.classroomId")
            .leftJoin("building", "building", "building.id = classroom.buildingId")
            .select([
                "subjectGroup.planSubjectId AS \"planSubjectId\"",
                "subjectGroup.id AS \"subjectGroupId\"",
                "subjectGroup.spots AS spots",
                "subjectGroup.group AS \"group\"",
                "teacher.name AS teacher",
                "gs.day AS day",
                "schedule.beginTime AS \"beginTime\"",
                "schedule.endTime AS \"endTime\"",
                "classroom.number AS classroom",
                "building.number AS building"
            ])
            .where("subjectGroup.planSubjectId IN (:...ids)", { ids: planSubjectIds })
            .orderBy("subjectGroup.planSubjectId", "ASC")
            .addOrderBy("subjectGroup.id", "ASC")
            .getRawMany();

        // Group results by planSubjectId and subjectGroupId
        const groupedByPlanSubject = new Map<number, Map<number, any>>();

        for (const row of results) {
            const planSubjectId = row.planSubjectId;
            const subjectGroupId = row.subjectGroupId;

            if (!groupedByPlanSubject.has(planSubjectId)) {
                groupedByPlanSubject.set(planSubjectId, new Map());
            }

            const groupsMap = groupedByPlanSubject.get(planSubjectId)!;

            if (!groupsMap.has(subjectGroupId)) {
                groupsMap.set(subjectGroupId, {
                    subjectGroupId: row.subjectGroupId,
                    spots: row.spots,
                    group: row.group,
                    teacher: row.teacher,
                    schedules: []
                });
            }

            // Add schedule if it exists
            if (row.day) {
                const group = groupsMap.get(subjectGroupId)!;
                group.schedules.push({
                    day: row.day,
                    beginTime: row.beginTime,
                    endTime: row.endTime,
                    classroom: row.classroom,
                    building: row.building
                });
            }
        }

        // Convert to final DTO structure
        const result: SubjectGroupResponseDto[] = [];
        for (const [planSubjectId, groupsMap] of groupedByPlanSubject.entries()) {
            result.push({
                planSubjectId,
                groups: Array.from(groupsMap.values())
            });
        }

        return result;
    }
}
