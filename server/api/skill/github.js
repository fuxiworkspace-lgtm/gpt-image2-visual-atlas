const skillUrl = 'https://raw.githubusercontent.com/fuxiworkspace-lgtm/gpt-image2-visual-atlas/main/agents/skills/gpt-image-2-style-library/SKILL.md';
const packageUrl = 'https://raw.githubusercontent.com/fuxiworkspace-lgtm/gpt-image2-visual-atlas/main/agents/skills/gpt-image-2-style-library/package.json';

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    const [skillResponse, packageResponse] = await Promise.all([fetch(skillUrl), fetch(packageUrl)]);
    if (!skillResponse.ok) return json(res, 502, { ok: false, error: 'GITHUB_SKILL_UNAVAILABLE' });
    const skillMarkdown = await skillResponse.text();
    const packageJson = packageResponse.ok ? await packageResponse.json() : {};
    const description = skillMarkdown.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] || packageJson.description || '';
    return json(res, 200, {
      ok: true,
      skill: {
        name: packageJson.name || 'gpt-image-2-style-library',
        version: packageJson.version || '',
        description: description.slice(0, 240),
        sourceUrl: 'https://github.com/fuxiworkspace-lgtm/gpt-image2-visual-atlas/tree/main/agents/skills/gpt-image-2-style-library'
      }
    });
  } catch {
    return json(res, 502, { ok: false, error: 'GITHUB_SKILL_UNAVAILABLE' });
  }
}
