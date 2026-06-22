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

    // Auth endpoints and runner bootstrap are public.
    if (
      request.url?.startsWith("/api/auth/") ||
      request.url === "/api/runner/up"
    ) {
      return true;
    }

    // Runner-facing endpoints authenticate with the runner profile token.
    if (this.isRunnerEndpoint(request.url)) {
      return this.authenticateRunner(request);
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

  private isRunnerEndpoint(url: string): boolean {
    // POST /api/runner/heartbeat
    if (url === "/api/runner/heartbeat") return true;
    // POST /api/runner/sessions/claim
    if (url === "/api/runner/sessions/claim") return true;
    // POST /api/runner/sessions/:id/events
    // POST /api/runner/sessions/:id/artifacts
    if (
      /^\/api\/runner\/sessions\/[^/]+\/(events|artifacts)$/.test(
        url.split("?")[0],
      )
    ) {
      return true;
    }
    return false;
  }

  private async authenticateRunner(request: any): Promise<boolean> {
    const runnerId = request.headers["x-taskforge-runner-id"];
    const auth = request.headers["authorization"];
    if (
      typeof runnerId !== "string" ||
      typeof auth !== "string" ||
      !auth.startsWith("Bearer ")
    ) {
      throw new UnauthorizedException("Missing runner credentials");
    }

    const token = auth.slice("Bearer ".length);
    const runner = await this.prisma.runnerProfile.findUnique({
      where: { id: runnerId },
    });
    if (!runner || runner.token !== token) {
      throw new UnauthorizedException("Invalid runner token");
    }

    request.user = { id: runner.ownerId, runnerId: runner.id };
    return true;
  }

  private superCanActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context) as Promise<boolean>;
  }
}
