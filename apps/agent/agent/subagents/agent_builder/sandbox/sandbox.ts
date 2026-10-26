import { defineSandbox } from "eve/sandbox";
import { configuredSandbox } from "../../../lib/sandbox-environment";

const sandbox = configuredSandbox();

export const environment = sandbox.environment;

export default defineSandbox(sandbox.open);
