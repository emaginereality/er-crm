import { createRoot } from "react-dom/client";
import { AiProviders } from "../../../app/(app)/[slug]/settings/ai-providers";
import { TRPCReactProvider } from "../../../lib/trpc/client";

const root = document.getElementById("root");
if (!root) throw new Error("The test root is missing.");

createRoot(root).render(
	<TRPCReactProvider>
		<main>
			<AiProviders />
		</main>
	</TRPCReactProvider>,
);
