import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { RepositoryProviderInput } from "@taskforge/contracts";
import { RepositoryProvider } from "./provider.port";

export interface GitLabConfig {
  token: string;
  baseUrl: string;
}

interface GitLabProject {
  id: number;
  path_with_namespace: string;
  default_branch?: string;
  web_url: string;
}

@Injectable()
export class GitLabRepositoryProvider implements RepositoryProvider {
  constructor(private readonly config: GitLabConfig) {}

  async fetchMetadata(input: RepositoryProviderInput) {
    const projectPath = this.extractProjectPath(input.url);
    const apiBase = this.resolveApiBase(input.url);
    const encodedPath = encodeURIComponent(projectPath);

    const response = await fetch(`${apiBase}/projects/${encodedPath}`, {
      headers: {
        "PRIVATE-TOKEN": this.config.token,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `GitLab API error: ${response.status} ${response.statusText} - ${body}`,
      );
    }

    const project = (await response.json()) as GitLabProject;
    return {
      defaultBranch: project.default_branch,
      externalId: String(project.id),
    };
  }

  async validateConnection() {
    const response = await fetch(`${this.config.baseUrl}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": this.config.token },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `GitLab connection failed: ${response.status} ${response.statusText} - ${body}`,
      );
    }
    return response.json();
  }

  private extractProjectPath(url: string): string {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
    // GitLab project paths are namespace/project; remove any trailing slashes
    path = path.replace(/\/$/, "");
    if (!path.includes("/")) {
      throw new InternalServerErrorException(
        `Invalid GitLab repository URL: ${url} (expected namespace/project)`,
      );
    }
    return path;
  }

  private resolveApiBase(repoUrl: string): string {
    const parsed = new URL(repoUrl);
    return `${parsed.origin}/api/v4`;
  }
}
