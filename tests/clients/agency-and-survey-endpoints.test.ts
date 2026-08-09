import axios from 'axios';
import { GHLApiClient } from '../../src/clients/ghl-api-client.js';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('current endpoint-specific API contracts', () => {
  let request: {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
    patch: jest.Mock;
    defaults: { headers: Record<string, string> };
    interceptors: {
      request: { use: jest.Mock };
      response: { use: jest.Mock };
    };
  };
  let client: GHLApiClient;

  beforeEach(() => {
    request = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      defaults: { headers: {} },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(request as never);
    client = new GHLApiClient({
      accessToken: 'test-token',
      baseUrl: 'https://services.leadconnectorhq.com',
      version: '2021-07-28',
      locationId: 'location-one',
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('uses the current survey submissions path, location query, and v3 header', async () => {
    request.get.mockResolvedValueOnce({ data: { submissions: [], meta: {} } });

    await client.getSurveySubmissions({
      locationId: 'location-one',
      page: 2,
      limit: 25,
      surveyId: 'survey-one',
    });

    expect(request.get).toHaveBeenCalledWith('/surveys/submissions', {
      params: {
        locationId: 'location-one',
        page: '2',
        limit: '25',
        surveyId: 'survey-one',
      },
      headers: { Version: 'v3' },
    });
  });

  it('uses current read-only agency inventory paths with v3 headers', async () => {
    request.get
      .mockResolvedValueOnce({ data: { company: { id: 'company-one' } } })
      .mockResolvedValueOnce({ data: { users: [] } })
      .mockResolvedValueOnce({ data: { snapshots: [] } });

    await client.getCompany('company-one');
    await client.searchUsers({ companyId: 'company-one' });
    await client.getSnapshots();

    expect(request.get).toHaveBeenNthCalledWith(1, '/companies/company-one', {
      headers: { Version: 'v3' },
    });
    expect(request.get).toHaveBeenNthCalledWith(2, '/users/search', {
      params: { companyId: 'company-one' },
      headers: { Version: 'v3' },
    });
    expect(request.get).toHaveBeenNthCalledWith(3, '/snapshots/', {
      headers: { Version: 'v3' },
    });
  });

  it('preserves endpoint status from the shared response interceptor', async () => {
    request.get.mockRejectedValueOnce(new Error('GHL API Error (403): Forbidden resource'));

    const result = client.getSnapshots();
    await expect(result).rejects.toThrow(
      'GHL API Error (403): Forbidden resource',
    );
    await expect(result).rejects.not.toThrow('GHL API Error (500)');
  });

  it('normalizes non-string recording headers to safe string defaults', async () => {
    request.get.mockResolvedValueOnce({
      data: new ArrayBuffer(0),
      headers: {
        'content-type': 123,
        'content-disposition': true,
      },
    });

    const result = await client.getMessageRecording('message-one');

    expect(result.data?.contentType).toBe('audio/x-wav');
    expect(result.data?.contentDisposition).toBe(
      'attachment; filename=audio.wav',
    );
  });
});
