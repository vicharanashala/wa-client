import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const CONFIG_FILENAME = 'config.yaml';

/**
 * Load and parse the YAML configuration file
 * This function is used by NestJS ConfigModule
 */
export default () => {
  // Determine config file path - prioritize root directory
  const configPath = join(process.cwd(), CONFIG_FILENAME);

  try {
    const config = yaml.load(readFileSync(configPath, 'utf8')) as Record<
      string,
      any
    >;

    // Validate that config was loaded
    if (!config) {
      throw new Error('Configuration file is empty');
    }

    // Apply environment variable overrides for specific settings
    // This allows runtime overrides without changing the YAML file
    const mergedConfig = {
      ...config,
      version: config.version, // Explicitly preserve version as string
      app: {
        ...config.app,
        environment:
          process.env.NODE_ENV || config.app?.environment || 'development',
        port:
          (process.env.PORT ? parseInt(process.env.PORT, 10) : null) ||
          config.app?.port ||
          3000,
        logLevel: process.env.LOG_LEVEL || config.app?.logLevel || 'info',
      },
      llm: {
        ...config.llm,
        // Allow env vars to override YAML for testing purposes
        defaultModel: process.env.LLM_MODEL || config.llm?.defaultModel,
        maxTokens:
          (process.env.MAX_TOKENS
            ? parseInt(process.env.MAX_TOKENS, 10)
            : null) ||
          config.llm?.maxTokens ||
          1024,
        temperature:
          (process.env.TEMPERATURE
            ? parseFloat(process.env.TEMPERATURE)
            : null) ||
          config.llm?.temperature ||
          0.7,
      },
      reviewer: {
        ...config.reviewer,
        polling: {
          ...config.reviewer?.polling,
          intervalMs:
            (process.env.REVIEWER_POLL_INTERVAL_MS
              ? parseInt(process.env.REVIEWER_POLL_INTERVAL_MS, 10)
              : null) ||
            config.reviewer?.polling?.intervalMs ||
            7200000,
        },
        api: {
          ...config.reviewer?.api,
          defaultBaseUrl:
            process.env.REVIEWER_API_BASE_URL ||
            config.reviewer?.api?.defaultBaseUrl,
        },
      },
      whatsapp: {
        ...config.whatsapp,
        api: {
          ...config.whatsapp?.api,
          version:
            process.env.WHATSAPP_API_VERSION ||
            config.whatsapp?.api?.version ||
            'v18.0',
        },
      },
    };

    return mergedConfig;
  } catch (error) {
    console.error(
      `Failed to load configuration from ${configPath}:`,
      error.message,
    );
    throw new Error(`Configuration loading failed: ${error.message}`);
  }
};
