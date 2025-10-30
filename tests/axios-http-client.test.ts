import { ErrorConstructor, NetworkError, SystemError, TimeoutError, toUltrasaErrorBody, UnauthenticatedError } from '@ultrasa/dev-kit';
import { AxiosHttpClient } from '../src/axios-http-client';
import { asleep, HttpServerBehavior, server, server2 } from './http-server';
import axios from 'axios';

describe('aixos-http-client-test', () => {
  // account integ endpoint.
  const PROTECTED_API_GATEWAY_URL = 'https://lt6dopbzl8.execute-api.us-east-1.amazonaws.com/prod';
  const ERROR_MESSAGE = 'mockErrorMessage';

  beforeEach(() => {
    jest.resetModules();
  });

  test('send_getHappyPath_shouldSucceed', async () => {
    const PORT = 23294;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });
    const capturePromise = server(PORT, {
      statusCode: 200,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    });

    const response = await client.send({
      method: 'GET',
      url: '/test',
      headers: {
        Authorization: 'Bearer 123',
      },
    });

    const request = await capturePromise;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('/test');
    expect(request.headers?.authorization).toBe('Bearer 123');
    expect(response.body).toEqual({ success: true });
  });

  test('send_getFirstPartyServiceWithKnownErrorWithErrorConstructor_shouldThrowDeserializedError', async () => {
    const PORT = 23295;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });
    expect.assertions(4);
    const capturePromise = server(PORT, {
      statusCode: 404,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toUltrasaErrorBody(new SystemError(ERROR_MESSAGE))),
    });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err) {
      const request = await capturePromise;
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/test');
      expect(err instanceof Error).toBeTruthy();
      expect((err as Error).message).toContain(ERROR_MESSAGE);
    }
  });

  class MockServiceError extends Error {
    constructor() {
      super(ERROR_MESSAGE);
    }
  }

  test('send_getFirstPartyServiceWithKnownError_shouldThrowDeserializedError', async () => {
    const PORT = 23392;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });
    expect.assertions(4);
    client.configure({
      type: 'error-constructor',
      errorNameToConstructor: new Map<string, ErrorConstructor>([['SystemError', NetworkError]]),
      serviceErrorConstructor: MockServiceError,
    });
    const capturePromise = server(PORT, {
      statusCode: 404,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toUltrasaErrorBody(new SystemError(ERROR_MESSAGE))),
    });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err) {
      const request = await capturePromise;
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/test');
      expect(err instanceof NetworkError).toBeTruthy();
      expect((err as NetworkError).message).toContain(ERROR_MESSAGE);
    }
  });

  test('send_getFirstPartyServiceWithServiceError_shouldThrowDeserializedError', async () => {
    const PORT = 23395;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });
    expect.assertions(4);
    client.configure({
      type: 'error-constructor',
      errorNameToConstructor: new Map<string, ErrorConstructor>([['X', NetworkError]]),
      serviceErrorConstructor: MockServiceError,
    });
    const capturePromise = server(PORT, {
      statusCode: 404,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toUltrasaErrorBody(new SystemError(ERROR_MESSAGE))),
    });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err) {
      const request = await capturePromise;
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/test');
      expect(err instanceof MockServiceError).toBeTruthy();
      expect((err as MockServiceError).message).toContain(ERROR_MESSAGE);
    }
  });

  test('send_getThirdPartyTextError_shouldRethrowOriginalAxiosError', async () => {
    const PORT = 23296;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });
    expect.assertions(5);
    const capturePromise = server(PORT, {
      statusCode: 401,
      header: { 'Content-Type': 'plain/text' },
      body: 'An Error Message',
    });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err: any) {
      const request = await capturePromise;
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/test');
      expect(err.isAxiosError).toBeTruthy();
      expect(err?.response?.data).toBe('An Error Message');
      expect(err?.response?.headers['content-type']).toBe('plain/text');
    }
  });

  test('send_getThirdPartyTextErrorWithHandler_shouldBeHandled', async () => {
    const PORT = 23303;
    class ThirdPartyError extends Error {
      constructor() {
        super(ERROR_MESSAGE);
      }
    }

    expect.assertions(5);
    const client = new AxiosHttpClient({
      baseUrl: `http://localhost:${PORT}`,
    });
    client.configure({
      type: 'http-error-handler',
      handler: (status: number, body: any) => {
        expect(status).toBe(401);
        expect(body).toBe('An Error Message');
        throw new ThirdPartyError();
      },
    });
    const capturePromise = server(PORT, {
      statusCode: 401,
      header: { 'Content-Type': 'plain/text' },
      body: 'An Error Message',
    });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err: any) {
      const request = await capturePromise;
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/test');
      // The fetch client throw EnhancedError
      expect(err instanceof ThirdPartyError).toBeTruthy();
    }
  });

  test('send_postWithData_shouldHaveJsonHeaderInRequest', async () => {
    const PORT = 23297;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });

    const capturePromise = server(PORT, {
      statusCode: 200,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    });

    const response = await client.send({
      method: 'POST',
      url: '/test',
      body: { message: 'Test' },
      headers: {
        Authorization: 'Bearer 456',
      },
    });

    const request = await capturePromise;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/test');
    expect(request.headers?.['content-type']).toBe('application/json');
    expect(request.headers?.['authorization']).toBe('Bearer 456');
    expect(response.body).toEqual({ success: true });
  });

  test('send_putInvalidPort_shouldBeECONNREFUSED', async () => {
    const PORT = 23298;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });

    try {
      await client.send({
        method: 'PUT',
        url: '/test',
        body: { message: 'Test' },
      });
    } catch (err) {
      expect(err instanceof NetworkError).toBeTruthy();
      expect((err as NetworkError).message).toEqual('Error');
    }
  });

  test('send_getTimeout_shouldBeTimeout', async () => {
    const PORT = 23299;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });

    expect.assertions(3);
    const capturePromise = server(
      PORT,
      {
        statusCode: 200,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      },
      1_000,
    );

    try {
      await client.send({
        method: 'GET',
        url: '/test',
        timeout: 500,
      });
    } catch (err: any) {
      expect(err instanceof TimeoutError).toBeTruthy();
      expect((err as NetworkError).message).toEqual('timeout of 500ms exceeded');
    }

    try {
      await capturePromise;
    } catch (err: any) {
      expect(err?.code).toBe('ERR_STREAM_DESTROYED');
    }
  });

  test('send_getWithDefaultTimeout_shouldBeTimeout', async () => {
    const PORT = 23300;
    const client = new AxiosHttpClient({
      baseUrl: `http://localhost:${PORT}`,
      timeout: 100,
    });

    expect.assertions(3);
    const capturePromise = server(
      PORT,
      {
        statusCode: 200,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      },
      1_000,
    );

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err: any) {
      expect(err instanceof TimeoutError).toBeTruthy();
      expect((err as NetworkError).message).toEqual('timeout of 100ms exceeded');
    }

    try {
      await capturePromise;
    } catch (err: any) {
      expect(err?.code).toBe('ERR_STREAM_DESTROYED');
    }
  });

  test('send_deleteAbort_shouldBeAborted', async () => {
    const PORT = 23301;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}` });

    expect.assertions(3);
    const capturePromise = server(
      PORT,
      {
        statusCode: 200,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      },
      1_000,
    );

    const controller = new AbortController();

    client
      .send({
        method: 'GET',
        url: '/test',
        signal: controller.signal,
      })
      .catch((err) => {
        expect(err instanceof NetworkError).toBeTruthy();
        expect((err as NetworkError).message).toEqual('canceled');
      });

    await asleep(100);
    controller.abort();

    try {
      await capturePromise;
    } catch (err: any) {
      expect(err?.code).toBe('ERR_STREAM_DESTROYED');
    }
  });

  test('send_apiGatewayMissingAuthenticationToken_shouldThrowEnhancedError', async () => {
    // the test case is a bit fragile because it asserts on the API gateway message.
    /**
     * { message: 'Missing Authentication Token' }
     */
    expect.assertions(2);
    const client = new AxiosHttpClient({ baseUrl: PROTECTED_API_GATEWAY_URL });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err: any) {
      expect(err instanceof UnauthenticatedError).toBeTruthy();
      expect((err as UnauthenticatedError).message).toEqual('Missing Authentication Token');
    }
  });

  test('send_invalidApiGatewayToken_shouldThrowEnhancedError', async () => {
    /**
     * {message: "Authorization header requires 'Credential' parameter. Authorization header requires 'Signature' parameter. Authorization header requires 'SignedHeaders' parameter. Authorization header requires existence of either a 'X-Amz-Date' or a 'Date' header. Authorization=mock"
     */
    const instance = axios.create({ baseURL: PROTECTED_API_GATEWAY_URL });
    instance.interceptors.request.use(async (config) => {
      expect.assertions(2);
      config.headers['authorization'] = 'mock';
      return config;
    });

    const client = new AxiosHttpClient({ instance });

    try {
      await client.send({
        method: 'GET',
        url: '/test',
      });
    } catch (err: any) {
      expect(err instanceof UnauthenticatedError).toBeTruthy();
      expect((err as UnauthenticatedError).message).toContain('Authorization header requires');
    }
  });

  test('send_with500ResponseAndRetry2Times_shouldInvoke3Times', async () => {
    const PORT = 23324;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}`, maximumRetry: 2 });
    const server = server2(PORT);
    const behaviors: HttpServerBehavior[] = [];
    expect.assertions(7);
    for (let i = 0; i < 10; i++) {
      behaviors.push({
        statusCode: 500,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false }),
        delay: 100,
      });
    }
    server.setBehaviors(behaviors);

    try {
      await client.send({
        method: 'GET',
        url: '/test',
        headers: {
          Authorization: 'Bearer 123',
        },
      });
    } catch (err: any) {
      expect(err.isAxiosError).toBeTruthy();
      expect(err?.response?.data).toEqual({ success: false });
      expect(err?.response?.status).toBe(500);
    }

    expect(server.getCapturedRequests().length).toBe(3);
    for (let i = 0; i < server.getCapturedRequests().length; i++) {
      expect(server.getCapturedRequests()[i]).toMatchObject({
        method: 'GET',
        url: '/test',
      });
    }
    server.close();
  });

  test('send_withRetryAndPostMethod_shouldNotRetryForPost', async () => {
    const PORT = 23329;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}`, maximumRetry: 2 });
    const server = server2(PORT);
    const behaviors: HttpServerBehavior[] = [];
    expect.assertions(5);
    for (let i = 0; i < 10; i++) {
      behaviors.push({
        statusCode: 500,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false }),
        delay: 100,
      });
    }
    server.setBehaviors(behaviors);

    try {
      await client.send({
        method: 'POST',
        url: '/test',
        headers: {
          Authorization: 'Bearer 123',
        },
      });
    } catch (err: any) {
      expect(err.isAxiosError).toBeTruthy();
      expect(err?.response?.data).toEqual({ success: false });
      expect(err?.response?.status).toBe(500);
    }

    expect(server.getCapturedRequests().length).toBe(1);

    expect(server.getCapturedRequests()[0]).toMatchObject({
      method: 'POST',
      url: '/test',
    });

    server.close();
  });

  test('send_with500ResponsePutMethodAndRetry5Times_shouldInvoke6Times', async () => {
    const PORT = 23325;
    const client = new AxiosHttpClient({ baseUrl: `http://localhost:${PORT}`, maximumRetry: 5 });
    const server = server2(PORT);
    const behaviors: HttpServerBehavior[] = [];
    expect.assertions(7);
    for (let i = 0; i < 5; i++) {
      behaviors.push({
        statusCode: 500,
        header: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false }),
      });
    }
    behaviors.push({
      statusCode: 200,
      header: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    });
    server.setBehaviors(behaviors);

    const response = await client.send({
      method: 'PUT',
      url: '/test',
      headers: {
        Authorization: 'Bearer 123',
      },
    });

    expect(server.getCapturedRequests().length).toBe(6);
    for (let i = 0; i < server.getCapturedRequests().length - 1; i++) {
      expect(server.getCapturedRequests()[i]).toMatchObject({
        method: 'PUT',
        url: '/test',
      });
    }

    expect(response.body).toEqual({ success: true });
    server.close();
  });
});
