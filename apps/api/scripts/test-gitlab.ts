import { GitLabRepositoryProvider } from "../src/repositories/gitlab.provider";

async function main() {
  const token = process.env.GITLAB_API_TOKEN;
  const repoUrl = process.env.GITLAB_REPO_URL;
  if (!token) {
    console.error("Missing GITLAB_API_TOKEN");
    process.exit(1);
  }
  if (!repoUrl) {
    console.error("Missing GITLAB_REPO_URL");
    process.exit(1);
  }

  const provider = new GitLabRepositoryProvider({
    token,
    baseUrl: new URL(repoUrl).origin,
  });

  console.log("Validating GitLab connection...");
  const user = await provider.validateConnection();
  console.log("Authenticated as:", user);

  console.log("Fetching metadata for", repoUrl);
  const metadata = await provider.fetchMetadata({
    provider: "gitlab",
    url: repoUrl,
  });
  console.log("Metadata:", metadata);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
