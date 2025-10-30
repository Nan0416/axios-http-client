import * as http from 'http';
import { IncomingHttpHeaders } from 'http';

export interface Response {
  readonly statusCode: number;
  readonly header?: any;
  readonly body?: any;
}

interface MutableRequest {
  url?: string;
  method?: string;
  headers?: IncomingHttpHeaders;
  body?: any;
}
export type Request = Readonly<MutableRequest>;

export async function asleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function server(port: number, response: Response, delay?: number): Promise<Request> {
  const promise = new Promise<Request>((resolve, reject) => {
    const request: MutableRequest = {};

    const server = http.createServer((req, res) => {
      (async () => {
        request.url = req.url;
        request.method = req.method;
        request.headers = req.headers;

        await asleep(delay ?? 0);

        res.writeHead(response.statusCode, response.header);
        res.write(response.body, (err) => {
          if (err) {
            /**
             * It will throw error if the client was aborted during or before transforming the data.
             */
            reject(err);
            listener.close();
          }
        });

        res.end((err: any) => {
          if (err) {
            reject(err);
          }
          listener.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve(request);
            }
          });
        });
      })();
    });

    const listener = server.listen(port);
  });
  return promise;
}

export interface HttpServerBehavior {
  readonly statusCode: number;
  readonly header: any;
  readonly body: any;
  readonly delay?: number;
}

export interface ControlledServer {
  readonly close: () => void;
  readonly setBehaviors: (behaviors: ReadonlyArray<HttpServerBehavior>) => void;
  readonly getCapturedRequests: () => Request[];
}

class ServerBehaviorContainer {
  private behaviors: HttpServerBehavior[];
  private readonly defaultBehavior: HttpServerBehavior;

  constructor() {
    this.defaultBehavior = {
      statusCode: 200,
      header: {},
      body: '',
      delay: 0,
    };
    this.behaviors = [];
  }

  setBehaviors(behaviors: ReadonlyArray<HttpServerBehavior>) {
    this.behaviors = Array.from(behaviors);
  }

  getBehavior(): HttpServerBehavior {
    if (this.behaviors.length > 0) {
      return this.behaviors.shift()!;
    } else {
      return this.defaultBehavior;
    }
  }
}
/**
 *
 * @param port
 * @param response
 * @param delay
 * @returns a callback function to close the server
 */
export function server2(port: number): ControlledServer {
  const behaviorContainer = new ServerBehaviorContainer();
  const capturedRequests: Request[] = [];

  const server = http.createServer((req, res) => {
    (async () => {
      const request: MutableRequest = {};
      request.url = req.url;
      request.method = req.method;
      request.headers = req.headers;

      const serverBehavior = behaviorContainer.getBehavior();
      await asleep(serverBehavior.delay ?? 0);

      res.writeHead(serverBehavior.statusCode, serverBehavior.header);
      res.write(serverBehavior.body);
      res.end(() => {
        capturedRequests.push(request);
      });
    })();
  });

  const listener = server.listen(port);

  return {
    close: () => listener.close(),
    setBehaviors: (behaviors: ReadonlyArray<HttpServerBehavior>) => behaviorContainer.setBehaviors(behaviors),
    getCapturedRequests: () => capturedRequests,
  };
}
