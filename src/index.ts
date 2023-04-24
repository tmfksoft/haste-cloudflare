import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler';

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	haste: KVNamespace;
}

declare global {
    var global: typeof globalThis;
    var haste: KVNamespace;
}

const config = {
	keyLength: 10,
}

interface HasteDocument {
	data: string,
	key: string,
}

addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method === "POST" && url.pathname.toLocaleLowerCase() === "/documents") {
		return event.respondWith(createHasteEvent(event));
	} else if (event.request.method === "GET") {
		const ex = url.pathname.toLowerCase().substring(1).split("/");
		if (ex[0] === "documents") {
			if (ex.length === 2) {
				const hasteId = fetchId(ex[1]);
				return event.respondWith(getHasteEvent(event, hasteId));
			}
		} else if (ex[0] === "raw") {
			if (ex.length === 2) {
				const hasteId = fetchId(ex[1]);
				return event.respondWith(getRawHasteEvent(event, hasteId));
			}
		}
	}
	event.respondWith(handleEvent(event));
});

function fetchId(fullName: string) {
	const ex = fullName.split(".");
	if (ex.length <= 0) {
		return "";
	}
	return ex[0].toLowerCase();
}

async function generateId() {
	const chars = "abcdefghijklmnopqrstuvewxyz".split("");
	let id = "";

	for (let i=0; i<config.keyLength; i++) {
		const idx = Math.floor(Math.random() * chars.length);
		id = id + chars[idx];
	}

	return id;
}

async function createHasteEvent(event: FetchEvent): Promise<Response> {

	const hasteContents = await event.request.text();
	const hasteId = await createHaste(hasteContents);
	
	return new Response(JSON.stringify({ key: hasteId }), {
		headers: {
			"Content-Type": "application/json"
		}
	});
}

async function getHasteEvent(event: FetchEvent, hasteId: string): Promise<Response> {
	const hasteDocument = await getHaste(hasteId);

	// No such document
	if (!hasteDocument) {
		return new Response(JSON.stringify({ message: "Document not found." }), {
			headers: {
				"Content-Type": "application/json"
			}
		});
	}

	return new Response(JSON.stringify(hasteDocument), {
		headers: {
			"Content-Type": "application/json"
		}
	});
}

async function getRawHasteEvent(event: FetchEvent, hasteId: string): Promise<Response> {
	const hasteDocument = await getHaste(hasteId);

	// No such document
	if (!hasteDocument) {
		return new Response(JSON.stringify({ message: "Document not found." }), {
			headers: {
				"Content-Type": "application/json"
			}
		});
	}

	return new Response(hasteDocument.data, {
		headers: {
			"Content-Type": "text/plain"
		}
	});
}

async function createHaste(hasteContents: string): Promise<string> {
	const hasteId = await generateId();
	await haste.put(hasteId, hasteContents);
	return hasteId;
}
async function getHaste(hasteId: string): Promise<HasteDocument | null> {
	const hasteContents = await haste.get(hasteId);
	if (!hasteContents) {
		return null;
	}
	return {
		data: hasteContents,
		key: hasteId.toLowerCase(),
	};
}

/**
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleEvent(event: FetchEvent) {
	let options: any = {};

	try {

		const page = await getAssetFromKV(event, options);

		// allow headers to be altered
		const response = new Response(page.body, page);

		response.headers.set('X-XSS-Protection', '1; mode=block');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Referrer-Policy', 'unsafe-url');
		response.headers.set('Feature-Policy', 'none');

		return response;
	} catch (err) {
		const e = err as Error;
		// If its a 404 return index.html which should load a document
		try {
			let notFoundResponse = await getAssetFromKV(event, {
				mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/index.html`, req),
			});

			const response = new Response(notFoundResponse.body, {
				...notFoundResponse,
			});
	
			return response;
		} catch (e) {
			console.log(e);
		}

		return new Response(e.message || e.toString(), { status: 500 });
	}
}