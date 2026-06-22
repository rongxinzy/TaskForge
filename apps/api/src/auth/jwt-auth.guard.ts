import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Auth endpoints are public.
    if (request.url?.startsWith("/api/auth/")) {
      return true;
    }

    // Try JWT first (cookie or Authorization header).
    const jwtResult = await this.superCanActivate(context).catch(() => false);
    if (jwtResult && request.user) {
      return true;
    }

    // Optional dev header fallback for local testing / CI.
    if (process.env.TASKFORGE_DEV_AUTH !== "false") {
      const userId = request.headers["x-taskforge-user-id"];
      if (userId && typeof userId === "string") {
        const email =
          typeof request.headers["x-taskforge-user-email"] === "string"
            ? request.headers["x-taskforge-user-email"]
            : `${userId}@taskforge.local`;
        const name =
          typeof request.headers["x-taskforge-user-name"] === "string"
            ? request.headers["x-taskforge-user-name"]
            : userId;

        await this.prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: { id: userId, email, name },
        });

        request.user = { id: userId, email, name };
        return true;
      }
    }

    throw new UnauthorizedException("Authentication required");
  }

  private superCanActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
