import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Term } from "./term.entity";

@Entity()
@Unique(["term","number"])
export class Period {
  
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  number: number;

  @ManyToOne(() => Term, { nullable: false, onDelete: "CASCADE" })
  term: Term;
}