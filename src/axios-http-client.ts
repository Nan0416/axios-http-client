import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  LoggerFactory,
  Configuration,
  ErrorConstructor,
  HttpClient,
  HttpRequest,
  HttpResponse,
  EndpointNotFoundError,
  IllegalArgumentError,
  isUltrasaErrorBody,
  NetworkError,
  TimeoutError,
  UnauthenticatedError,
} from '@ultrasa/dev-kit';
import axiosRetry from 'axios-retry';

const logger = LoggerFactory.getLogger('AxiosHttpClient');

export interface AxiosHttpClientProps {
  readonly instance?: AxiosInstance;
  /**
   * baseUrl, timeout, and interceptors wont' be effective if an axios instance is given.
   */
  readonly baseUrl?: string;
  readonly timeout?: number;
  readonly interceptors?: ReadonlyArray<Interceptor> | Interceptor;
  /**
   * Note, this is the number of retries, not the number of attempts.
   * For example, if you set it to 3, it will try 4 times in total.
   */
  readonly maximumRetry?: number;
}

export type Interceptor = (value: AxiosRequestConfig) => AxiosRequestConfig | Promise<AxiosRequestConfig>;

interface ErrorConstructors {
  readonly serviceErrorConstructor?: ErrorConstructor | null;
  readonly errorNameToConstructor?: ReadonlyMap<string, ErrorConstructor> | null;
}

export class AxiosHttpClient implements HttpClient {
  private readonly httpClient: AxiosInstance;
  private errorHandler?: ((status: number, body: any) => void) | null;
  private errorConstructors?: ErrorConstructors | null;

  constructor(props: AxiosHttpClientProps) {
    if (props.instance) {
      this.httpClient = props.instance;
    } else {
      this.httpClient = axios.create({
        baseURL: props.baseUrl,
        timeout: props.timeout,
      });

      if (props.interceptors) {
        const interceptors = Array.isArray(props.interceptors) ? props.interceptors : [props.interceptors];
        interceptors.forEach((interceptor) => this.httpClient.interceptors.request.use(interceptor));
      }

      if (typeof props.maximumRetry === 'number' && props.maximumRetry > 0) {
        // Having retry at the end.
        // By default, it retries if it is a network error or a 5xx error on an idempotent request (GET, HEAD, OPTIONS, PUT or DELETE).
        axiosRetry(this.httpClient, { retries: props.maximumRetry, retryDelay: axiosRetry.exponentialDelay });
      }
    }
  }

  configure(config: Configuration): void {
    if (config.type === 'http-error-handler') {
      this.errorHandler = config.handler;
    } else if (config.type === 'error-constructor') {
      this.errorConstructors = {
        errorNameToConstructor: config.errorNameToConstructor,
        serviceErrorConstructor: config.serviceErrorConstructor,
      };
    }
  }

  async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    logger.debug(`Send request to ${request.url}?${new URLSearchParams(request.query).toString()}.`);

    const config: AxiosRequestConfig = {
      params: {
        // create a copy instead of in-place, to avoid axios update the query.
        ...request.query,
      },
      signal: request.signal,
      timeout: request.timeout,
      baseURL: request.baseUrl,
      headers: request.headers,
    };
    try {
      if (request.method === 'GET') {
        const resp = await this.httpClient.get<T>(request.url, config);
        return { body: resp.data };
      } else if (request.method === 'DELETE') {
        const resp = await this.httpClient.delete<T>(request.url, config);
        return { body: resp.data };
      } else if (request.method === 'POST') {
        /**
         * Axios automatically add 'Content-Type: application/json;charset=utf-8'
         * header if the body is a javascript object for POST, PUT, and PATCH methods.
         */
        const resp = await this.httpClient.post<T>(request.url, request.body, config);
        return { body: resp.data };
      } else if (request.method === 'PUT') {
        const resp = await this.httpClient.put<T>(request.url, request.body, config);
        return { body: resp.data };
      } else if (request.method === 'PATCH') {
        const resp = await this.httpClient.patch<T>(request.url, request.body, config);
        return { body: resp.data };
      } else {
        throw new IllegalArgumentError(`Invalid method ${(request as any).method}.`);
      }
    } catch (err: any) {
      logger.debug(`Received failure when sending request to ${request.url}?${new URLSearchParams(request.query).toString()}`);
      this.rethrowError(err);
    }
  }

  /**
   * Network error
   * Authentication error (from api gateway)
   * NotFound error (from express, endpoint not found)
   * First party application error: we control the error response body, but we may not have the corresponding error constructor. It happens
   *  when the error was thrown by an upstream first party service, or the code was not using the latest error library.
   *  If the constructor doesn't know how to deserialize it, it will deserialize an Error.
   * Third party application error: we don't control the error response. (e.g. We can use the library to call Polygon service).
   *  Deserialize the error through thirdPartyErrorHandler
   * @param error
   * @returns
   */
  private rethrowError(error: any): never {
    if (error.isAxiosError) {
      const axiosError = error as AxiosError;
      const body = error.response?.data;

      if (axiosError.response === undefined) {
        // network issue, no connection, aborted, timeout, etc.
        if (axiosError.message?.startsWith('timeout')) {
          // Because the version of Node.js we support doesn't support Error cause,
          // we can't pass the err into the TimeoutError, otherwise, we can do it like Java exception.
          logger.warn(axiosError.stack ?? '');
          throw new TimeoutError(error.message);
        }
        const message = error.message ?? error.code;
        throw new NetworkError(message);
      } else if (this.errorHandler) {
        // if an custom error handler is provided, use it.
        throw this.errorHandler(axiosError.response?.status, body);
      } else if (isUltrasaErrorBody(body)) {
        if (this.errorConstructors?.errorNameToConstructor) {
          // log the error stack and construct a new error and re-throw.
          logger.warn(`Received service error ${body.name}: ${body.message}`);
          let constructor = this.errorConstructors.errorNameToConstructor.get(body.name);
          if (constructor !== undefined) {
            throw new constructor(body.message);
          }
        }

        if (this.errorConstructors?.serviceErrorConstructor) {
          logger.warn(`Received service error but no error constructor it provided. ${body.name}: ${body.message}`);
          throw new this.errorConstructors.serviceErrorConstructor(`${body.name}: ${body.message}`);
        } else {
          logger.warn(`Received service error but no service error constructor it provided. ${body.name}: ${body.message}`);
          throw new Error(`${body.name}: ${body.message}`);
        }
      } else if (axiosError.response.status === 403) {
        // e.g. from APIGateway.
        logger.warn(axiosError.stack ?? '');
        let message = (axiosError.response?.data as any)?.message;
        throw new UnauthenticatedError(typeof message === 'string' ? message : '');
      } else if (axiosError.response.status === 404) {
        logger.warn(axiosError.stack ?? '');
        let message = (axiosError.response?.data as any)?.message;
        throw new EndpointNotFoundError(typeof message === 'string' ? message : '');
      } else {
        throw error;
      }
    } else if (error?.message === 'canceled') {
      // abort with abortcontroller.
      throw new NetworkError(error.message);
    } else {
      throw error;
    }
  }
}
