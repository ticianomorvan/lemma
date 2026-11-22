import { Button } from "#components/ui/button.tsx";
import { APP_NAME } from "../shared/app.ts";

export function App() {
	return (
		<main className="grid min-h-dvh place-content-center justify-items-center gap-4 px-4 text-center">
			<div className="grid gap-1">
				<h1 className="font-heading text-3xl font-semibold">{APP_NAME}</h1>
				<p className="text-muted-foreground">
					Tu espacio de estudio está en construcción.
				</p>
			</div>
			<Button disabled>Próximamente</Button>
		</main>
	);
}
