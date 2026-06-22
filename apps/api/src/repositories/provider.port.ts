import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RepositoryProviderInput } from "@taskforge/contracts";

export interface RepositoryProvider {
  fetchMetadata(input: RepositoryProviderInput): Promise<{
    defaultBranch?: string;
    externalId?: string;
  }>;
}

function parseGitHubRepo(url: string): { owner: string; repo: string } {
  const match = url.match(
    /(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (!match) {
    throw new BadRequestException("Invalid GitHub repository URL");
  }
  return { owner: match[1], repo: match[2] };
}

@Injectable()
export class GitHubRepositoryProvider implements RepositoryProvider {
  async fetchMetadata(input: RepositoryProviderInput) {
    const { owner, repo } = parseGitHubRepo(input.url);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (input.accessToken) {
      headers.Authorization = `Bearer ${input.accessToken}`;
    }

    const resp = await fetch(apiUrl, { headers });
    if (!resp.ok) {
      if (resp.status === 404) {
        throw new NotFoundException("GitHub repository not found");
      }
      const text = await resp.text().catch(() => "");
      throw new BadRequestException(
        `GitHub API error: ${resp.status} ${text}`,
      );
    }

    const data = (await resp.json()) as {
      default_branch?: string;
      id?: number;
    };
    return {
      defaultBranch: data.default_branch,
      externalId: data.id?.toString(),
    };
  }
}
