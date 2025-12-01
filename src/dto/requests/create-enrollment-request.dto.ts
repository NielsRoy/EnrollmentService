// import { IsArray, IsBoolean, IsInt, IsNotEmpty, ArrayMinSize, ArrayUnique } from 'class-validator';

export class CreateEnrollmentRequestDto {

    // @IsInt()
    // @IsNotEmpty()
    studentId: number;




    // @IsArray()
    // @ArrayMinSize(1, { message: 'Debe inscribir al menos una materia' })
    // @ArrayUnique({ message: 'No puede inscribir el mismo grupo más de una vez' })
    // @IsInt({ each: true })
    subjectGroupIds: number[];


    // @IsBoolean()
    online: boolean;
}
