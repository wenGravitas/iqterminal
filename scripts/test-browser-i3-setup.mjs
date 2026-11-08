export const testBrowserArgs=['--class=IQTerminalPerf','--name=IQTerminalPerf','--ozone-platform=x11'];
/** Headed testing is disabled until workspace isolation is verified independently.
 * Checking i3 rules alone did not prevent desktop disruption. Do not map a test
 * window, including when the former IQ_TEST_HEADED override is set.
 */
export function verifyHeadedBrowser(options={}){
 if(options.headless===false)throw new Error('Refusing headed test browser: desktop isolation is unverified; run headless');
}
export default function verifyTestBrowserWorkspace(config){
 for(const project of config.projects)verifyHeadedBrowser({...project.use.launchOptions,headless:project.use.headless});
}
