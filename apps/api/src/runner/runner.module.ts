import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "../common/prisma.module";
import { RedisModule } from "../common/redis.module";
import { AuditModule } from "../audit/audit.module";
import { OutboxModule } from "../outbox/outbox.module";
import { ProjectsModule } from "../projects/projects.module";
import { RunnerService } from "./runner.service";
import { RunnerController } from "./runner.controller";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuditModule,
    OutboxModule,
    ProjectsModule,
  ],
  providers: [RunnerService],
  controllers: [RunnerController],
})
export class RunnerModule {}
