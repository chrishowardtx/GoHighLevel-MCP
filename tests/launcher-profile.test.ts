import fs from 'node:fs';
import path from 'node:path';

describe('profile launcher guardrails', () => {
  const launcher = fs.readFileSync(path.join(process.cwd(), 'launcher-profile.sh'), 'utf8');

  it('pins the expected agency and location identities', () => {
    expect(launcher).toContain('EXPECTED_COMPANY_ID="QrtXvBAldeRz6qcMX1Xt"');
    expect(launcher).toContain('LOCATION_ID="Zx79DWMGfKGScgkURSvh"');
    expect(launcher).toContain('LOCATION_ID="a7Caoa2IgRnZOazJLyAm"');
    expect(launcher).toContain('LOCATION_ID="z8c1C1bHuVV8R3ttsd6o"');
    expect(launcher).toContain('export GHL_EXPECTED_COMPANY_ID="$EXPECTED_COMPANY_ID"');
    expect(launcher).toContain('export GHL_EXPECTED_LOCATION_ID="$LOCATION_ID"');
  });

  it('keeps mutation mode off unless the explicit launcher flag is present', () => {
    expect(launcher).toContain('MUTATION_FLAG="${2:-}"');
    expect(launcher).toContain('if [ "$MUTATION_FLAG" = "--allow-mutations" ]');
    expect(launcher).toContain('export GHL_ENABLE_MUTATIONS="true"');
    expect(launcher).toContain('unset GHL_ENABLE_MUTATIONS');
  });

  it('pins the official origin and clears cross-profile credential state', () => {
    expect(launcher).toContain('export GHL_BASE_URL="https://services.leadconnectorhq.com"');
    expect(launcher).toContain(
      'unset GHL_AGENCY_API_KEY GHL_RESTORERADAR_API_KEY GHL_HATTIE_API_KEY',
    );
  });
});
