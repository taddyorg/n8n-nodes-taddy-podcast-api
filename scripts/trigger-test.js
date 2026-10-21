#!/usr/bin/env node
// Dev-only: exercises the trigger node's webhook() secret check with a mocked IWebhookFunctions.
const path = require('path');
const { TaddyPodcastApiTrigger } = require(
	path.join(__dirname, '../dist/nodes/TaddyPodcastApi/TaddyPodcastApiTrigger.node.js'),
);

function ctx({ secretHeader, storedSecret = 'shh-secret', verifySecret = true }) {
	let status = 200;
	let ended = false;
	return {
		status: () => status,
		ended: () => ended,
		getWorkflowStaticData: () => ({ webhookId: '1', webhookSecret: storedSecret }),
		getNodeParameter: (name, fallback) => (name === 'options' ? { verifySecret } : fallback),
		getHeaderData: () =>
			secretHeader === undefined ? {} : { 'x-taddy-webhook-secret': secretHeader },
		getBodyData: () => ({
			uuid: 'e1',
			taddyType: 'podcastepisode',
			action: 'created',
			timestamp: 1,
			data: { name: 'Ep' },
		}),
		getResponseObject: () => ({
			status(code) {
				status = code;
				return this;
			},
			send() {
				return this;
			},
			end() {
				ended = true;
			},
		}),
		helpers: {
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
}

(async () => {
	const node = new TaddyPodcastApiTrigger();
	let fails = 0;
	const check = (name, ok) => {
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
		if (!ok) fails += 1;
	};

	let c = ctx({ secretHeader: 'shh-secret' });
	let r = await node.webhook.call(c);
	check(
		'valid secret -> workflow data emitted',
		r.workflowData?.[0]?.[0]?.json?.uuid === 'e1' && c.status() === 200,
	);

	c = ctx({ secretHeader: 'wrong' });
	r = await node.webhook.call(c);
	check(
		'wrong secret -> 401, no execution',
		r.noWebhookResponse === true && c.status() === 401 && c.ended(),
	);

	c = ctx({ secretHeader: undefined });
	r = await node.webhook.call(c);
	check('missing header -> 401', r.noWebhookResponse === true && c.status() === 401);

	c = ctx({ secretHeader: 'shh-secre' });
	r = await node.webhook.call(c);
	check(
		'length mismatch -> 401 (no timingSafeEqual throw)',
		r.noWebhookResponse === true && c.status() === 401,
	);

	c = ctx({ secretHeader: undefined, verifySecret: false });
	r = await node.webhook.call(c);
	check('verification disabled -> accepted', r.workflowData?.[0]?.length === 1);

	const d = node.description;
	check(
		'trigger description: no inputs, webhook declared, events default',
		d.inputs.length === 0 &&
			d.webhooks[0].responseMode === 'onReceived' &&
			d.properties.find((p) => p.name === 'events').default[0] === 'podcastepisode.created',
	);
	check(
		'all three lifecycle methods present',
		['checkExists', 'create', 'delete'].every(
			(m) => typeof node.webhookMethods.default[m] === 'function',
		),
	);

	console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
	process.exit(fails ? 1 : 0);
})();
