import { ExponentialBackoff, handleAll, retry } from 'cockatiel';
import nock from 'nock';
import { HttpServiceOptions } from '../types';
import { HttpService } from './http-service';

describe('HttpService', () => {
  it.each`
    getAuthToken                  | expectedHeaders
    ${async () => '123456abcdef'} | ${{ Authorization: 'Bearer 123456abcdef' }}
    ${undefined}                  | ${{}}
  `(
    'should attach the correct headers to the request',
    async ({ getAuthToken, expectedHeaders }) => {
      const baseUrl = 'http://localhost:3000';
      const path = 'slack';

      nock(baseUrl).get(`/${path}`).reply(200);

      const httpService = new HttpService(baseUrl, getAuthToken);
      expect(httpService.http.defaults.options.headers).toEqual(
        expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json',
        }),
      );

      const headers = (await httpService.http.get(path)).request.options
        .headers;
      expect(headers).toMatchObject({
        accept: 'application/json',
        'content-type': 'application/json',
        ...expectedHeaders,
      });
    },
  );

  describe('.getJson', () => {
    it('should call the got.get', async () => {
      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const getResponse = { tag: 1234567 };
      nock(baseUrl).get(`/${path}`).reply(200, getResponse);

      const httpService = new HttpService(baseUrl);
      const gotGet = jest.spyOn(httpService.http, 'get');
      const response = await httpService.getJson(path);

      expect(gotGet).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual({ tag: 1234567 });
      expect(response.statusCode).toBe(200);
    });

    it('should return to correct data when dto is provided', async () => {
      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const getResponse = {
        tag: 1234567,
        createdAt: '2022-08-09T16:08:37+10:00',
      };

      nock(baseUrl).get(`/${path}`).reply(200, getResponse);

      class Dto {
        tag: number;

        createdAt: Date;
      }

      const httpService = new HttpService(baseUrl);
      const gotGet = jest.spyOn(httpService.http, 'get');
      const response = await httpService.getJson<Dto>(path);

      expect(gotGet).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual(getResponse);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('.postJson', () => {
    it('should call the got.post', async () => {
      const baseUrl = 'https://reqres.in/api/';
      const path = 'users';
      const postPayload = {
        name: 'Mack Bloke',
      };
      const postResponse = {
        name: 'Mack Bloke',
        id: '557',
        createdAt: '2022-06-28T06:35:00.528Z',
      };

      nock(baseUrl).post(`/${path}`).reply(201, postResponse);

      const httpService = new HttpService(baseUrl, undefined, {
        logging: {
          maskProperties: ['name'],
        },
      });
      const gotPost = jest.spyOn(httpService.http, 'post');
      const response = await httpService.postJson(path, postPayload);

      expect(gotPost).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual(postResponse);
      expect(response.statusCode).toEqual(201);
    });
  });

  describe('.putJson', () => {
    it('should call the got.put', async () => {
      const baseUrl = 'https://reqres.in/api/';
      const path = 'users';
      const putPayload = {
        id: '123',
        address: 'new address',
      };
      const putResponse = {
        id: '123',
        name: 'Mack Bloke',
        updatedAt: '2022-06-28T06:35:00.528Z',
      };

      nock(baseUrl).put(`/${path}`).reply(204, putResponse);

      const httpService = new HttpService(baseUrl);
      const gotPut = jest.spyOn(httpService.http, 'put');
      const response = await httpService.putJson(path, putPayload);

      expect(gotPut).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual(putResponse);
      expect(response.statusCode).toEqual(204);
    });
  });

  describe('.deleteJson', () => {
    it('should call the got.delete', async () => {
      const baseUrl = 'https://reqres.in/api/';
      const path = 'users/123';
      const deleteResponse = {
        id: '123',
        deletedAt: '2022-06-28T06:35:00.528Z',
      };

      nock(baseUrl).delete(`/${path}`).reply(204, deleteResponse);

      const httpService = new HttpService(baseUrl);
      const gotDelete = jest.spyOn(httpService.http, 'delete');
      const response = await httpService.deleteJson(path);

      expect(gotDelete).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual(deleteResponse);
      expect(response.statusCode).toEqual(204);
    });
  });

  describe('auth token auto-renewal', () => {
    it('should retry the request with a new auth token if the request fails with a 401', async () => {
      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const getResponseUnauthorized = {
        message: 'Unauthorized',
      };

      const getResponse = {
        tag: 1234567,
        createdAt: '2022-08-09T16:08:37+10:00',
      };

      class Dto {
        tag: number;

        createdAt: Date;
      }

      nock(baseUrl)
        .get(`/${path}`)
        .reply(401, getResponseUnauthorized)
        .get(`/${path}`)
        .reply(200, getResponse)
        .get(`/${path}`)
        .reply(200, getResponse);

      const getAuthToken = jest.fn().mockResolvedValue('123456abcdef');
      const httpService = new HttpService(baseUrl, getAuthToken);
      const gotGet = jest.spyOn(httpService.http, 'get');

      // makes 2 first calls one with 401 and the retry with 200
      const responseRetry = await httpService.getJson<Dto>(path);

      // makes the last call to make sure the auth token is available
      const response = await httpService.getJson<Dto>(path);

      expect(gotGet).toHaveBeenCalledTimes(2);
      expect(getAuthToken).toHaveBeenCalledTimes(2);

      expect(responseRetry).toStrictEqual(response);
      expect(responseRetry.data).toEqual(getResponse);
      expect(responseRetry.statusCode).toBe(200);
    });

    it('should work for all methods', async () => {
      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const unauthorizedResponse = {
        message: 'Unauthorized',
      };

      const successResponse = {
        tag: 1234567,
        createdAt: '2022-08-09T16:08:37+10:00',
      };

      class Dto {
        tag: number;

        createdAt: Date;
      }

      nock(baseUrl)
        .post(`/${path}`)
        .reply(401, unauthorizedResponse)
        .post(`/${path}`)
        .reply(200, successResponse)
        .put(`/${path}`)
        .reply(401, unauthorizedResponse)
        .put(`/${path}`)
        .reply(200, successResponse)
        .delete(`/${path}`)
        .reply(401, unauthorizedResponse)
        .delete(`/${path}`)
        .reply(200, successResponse);

      const getAuthToken = jest.fn().mockResolvedValue('123456abcdef');
      const httpService = new HttpService(baseUrl, getAuthToken);
      const gotPost = jest.spyOn(httpService.http, 'post');
      const gotPut = jest.spyOn(httpService.http, 'put');
      const gotDelete = jest.spyOn(httpService.http, 'delete');

      await httpService.postJson<Dto>(path);
      await httpService.putJson<Dto>(path);
      await httpService.deleteJson<Dto>(path);

      expect(gotPost).toHaveBeenCalledTimes(1);
      expect(gotPut).toHaveBeenCalledTimes(1);
      expect(gotDelete).toHaveBeenCalledTimes(1);
      expect(getAuthToken).toHaveBeenCalledTimes(4);
    });
  });

  describe('support cockatiel policies', () => {
    it('should retry the request if a retry policy provided', async () => {
      const retryPolicy = retry(handleAll, {
        maxAttempts: 3,
        backoff: new ExponentialBackoff(),
      });

      const retryFailure = jest.fn();
      const retrySuccess = jest.fn();
      retryPolicy.onFailure(retryFailure);
      retryPolicy.onSuccess(retrySuccess);

      const options: HttpServiceOptions = {
        resilience: {
          policy: retryPolicy,
        },
      };

      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const getResponse = { tag: 1234567 };
      nock(baseUrl)
        .get(`/${path}`)
        .reply(400, getResponse)
        .get(`/${path}`)
        .reply(400, getResponse)
        .get(`/${path}`)
        .reply(200, getResponse);

      const httpService = new HttpService(baseUrl, null, options);
      const gotGet = jest.spyOn(httpService.http, 'get');
      const response = await httpService.getJson(path);

      expect(gotGet).toHaveBeenCalledTimes(3);
      expect(retryFailure).toHaveBeenCalledTimes(2);
      expect(retrySuccess).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual({ tag: 1234567 });
      expect(response.statusCode).toBe(200);
    });
    it('should retry the request if a retry policy is provided via HttpRequestOptions', async () => {
      const retryPolicy = retry(handleAll, {
        maxAttempts: 3,
        backoff: new ExponentialBackoff(),
      });

      const retryFailure = jest.fn();
      const retrySuccess = jest.fn();
      retryPolicy.onFailure(retryFailure);
      retryPolicy.onSuccess(retrySuccess);

      const baseUrl = 'https://icanhazdadjoke.com/';
      const path = 'slack';

      const getResponse = { tag: 1234567 };
      nock(baseUrl)
        .get(`/${path}`)
        .reply(400, getResponse)
        .get(`/${path}`)
        .reply(400, getResponse)
        .get(`/${path}`)
        .reply(200, getResponse);

      const httpService = new HttpService(baseUrl);
      const gotGet = jest.spyOn(httpService.http, 'get');
      const response = await httpService.getJson(path, {
        resiliencePolicy: retryPolicy,
      });

      expect(gotGet).toHaveBeenCalledTimes(3);
      expect(retryFailure).toHaveBeenCalledTimes(2);
      expect(retrySuccess).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual({ tag: 1234567 });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('mask', () => {
    it('should return the original object if logging is disabled', () => {
      const httpService = new HttpService('https://reqres.in/api/');
      const obj = { a: 1, b: 2 };
      expect(httpService.mask(obj)).toEqual(obj);
    });

    it('should hide properties specified in the logging options', () => {
      const httpService = new HttpService('https://reqres.in/api/', undefined, {
        logging: { hideProperties: ['b'] },
      });
      const obj = { a: 1, b: 2, c: 3 };
      expect(httpService.mask(obj)).toEqual({ a: 1, c: 3 });
    });

    it('should mask properties specified in the logging options', () => {
      const httpService = new HttpService('https://reqres.in/api/', undefined, {
        logging: { maskProperties: ['b'] },
      });
      const obj = { a: 1, b: 2, c: 3 };
      expect(httpService.mask(obj)).toEqual({ a: 1, b: '*', c: 3 });
    });

    it('should recursively hide and mask properties', () => {
      const httpService = new HttpService('https://reqres.in/api/', undefined, {
        logging: { hideProperties: ['c'], maskProperties: ['d'] },
      });
      const obj = { a: 1, b: { c: 2, d: 3 }, e: 4 };
      expect(httpService.mask(obj)).toEqual({
        a: 1,
        b: { c: undefined, d: '*' },
        e: 4,
      });
    });
  });
});
