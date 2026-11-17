import {defineConfig} from '@playwright/test';
import base from './playwright.footprint-batch.config';
export default defineConfig({...base,testMatch:'order-walls-ui.spec.ts'});
