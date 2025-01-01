import { defineNuxtConfig } from 'nuxt/config';
import dotenv from 'dotenv';

dotenv.config();

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2024-04-03',
    modules: ['@nuxt/ui', '@nuxt/icon'],
    ui: {
        icons: ['heroicons', 'simple-icons']
    },
    runtimeConfig: {
        public: {
            GHOSTFOLIO_VALIDATE: process.env.GHOSTFOLIO_VALIDATE,
            GHOSTFOLIO_IMPORT: process.env.GHOSTFOLIO_IMPORT,
            GHOSTFOLIO_UPDATE_CASH: process.env.GHOSTFOLIO_UPDATE_CASH,
            GHOSTFOLIO_ACCOUNT_ID: process.env.GHOSTFOLIO_ACCOUNT_ID,
            GHOSTFOLIO_URL: process.env.GHOSTFOLIO_URL,
            GHOSTFOLIO_SECRET: process.env.GHOSTFOLIO_SECRET,
            serverUrl: process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3001/',
            isDev: process.env.NODE_ENV !== 'production',
        },
    },
    ssr: false,
    target: 'static',
})