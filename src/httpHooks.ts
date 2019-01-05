import chalk from 'chalk';
import { httpApi } from '../common/src/http/httpApiService';
import { HttpLikeOptions } from '../common/src/http/httpLike';
import {
  onBeforeEachHttp,
  onBeforeHttp,
  onHttpFail,
  onHttpSuccess,
  McHttpOptions
} from '../common/src/http/mcHttp';
import { authConfigFile } from './config/authConfigFile';
import { configFile } from './config/mainConfigFile';

let warnedNoPassword = false;

async function getUsePort(
  port: number | undefined,
  useHttp: boolean | undefined
) {
  const usePort = port === undefined ? (useHttp ? 8000 : 8443) : port;
  return usePort;
}

export async function prepareHttp(
  noSession: boolean
): Promise<HttpLikeOptions> {
  let options: Partial<HttpLikeOptions> = {};

  if (!noSession) {
    if (!warnedNoPassword) {
      const { noPassword } = await httpApi.GetSoftwareVersion();
      if (noPassword) {
        console.warn(
          chalk.keyword('orange')(
            'A password was not set for the microcontroller. Please set a password via the lowsync settings set command.'
          )
        );
      }
      warnedNoPassword = true;
    }
    let password = await authConfigFile.getKey('password');
    options = {
      noSession: true,
      password: password || ''
    };
  }

  let ip = await configFile.getKey('ip');
  const port = await configFile.getKey('port');
  let useHttp = await configFile.getKey('useHttp');

  options = {
    ...options,
    ip,
    port: await getUsePort(port, useHttp),
    ssl: !useHttp
  };

  return options;
}

onBeforeHttp(async (options: MyOptions) => {
  const opts = await prepareHttp(!!options.noSession);
  return { ...options, ...opts };
});

interface MyOptions extends McHttpOptions {
  timer: NodeJS.Timer | undefined;
}

onBeforeEachHttp(async (options: MyOptions) => {
  const protocol = options.ssl ? 'https' : 'http';
  const url = `${protocol}://${options.ip}:${options.port}`;
  options.timer = setTimeout(() => {
    console.log(
      `Testing connection to microcontroller at ${url}... This can take a while if your connection is bad. If the url is incorrect, please abort lowsync and change the config file or run lowsync init.`
    );
  }, 4000);

  return options;
});

async function saveConn(options: MyOptions) {
  await configFile.setKey('ip', options.ip!);
  await configFile.setKey('useHttp', !options.ssl);
  if (options.port === (await getUsePort(undefined, !options.ssl))) {
    await configFile.setKey('port', undefined);
  } else {
    await configFile.setKey('port', options.port!);
  }
}

async function savePassword(options: MyOptions) {
  if (options.password !== undefined)
    await authConfigFile.setKey('password', options.password);
}

onHttpSuccess(async (options: MyOptions) => {
  options.timer && clearTimeout(options.timer);
  delete options.timer;

  await savePassword(options);
  await saveConn(options);
});

export async function onFail<TOptions extends MyOptions>(
  options: TOptions,
  forbidden: boolean,
  connErr: boolean
): Promise<TOptions | void> {
  options.timer && clearTimeout(options.timer);
  delete options.timer;

  if (connErr) {
    console.error(
      chalk.red(
        `The device cannot be reached with the provided protocol, IP and port (${`${
          options.ip
        } ${options.port} ssl: ${options.ssl}`}).`
      )
    );
    const ip = await configFile.prompt('ip');
    const port = await configFile.prompt('port');
    const useHttp = await configFile.prompt('useHttp');
    return {
      ...options,
      ip,
      port,
      ssl: !useHttp
    };
  } else await saveConn(options);

  if (forbidden) {
    let password = await authConfigFile.getKey('password');
    const msg =
      password === undefined
        ? 'A password was not provided.'
        : 'Wrong password.';
    password = await authConfigFile.prompt('password', {
      err: msg
    });
    return {
      ...options,
      password: password || ''
    };
  } else await savePassword(options);
}

onHttpFail((options: MyOptions, error, response) => {
  return onFail(
    options,
    (response && response.status === 401) || false,
    !response
  );
});