const { Connection } = require('node-vmix');
const io = require("socket.io-client");
const assert = require("assert");

const config = require("./config.json");

let default_video_source = "";
let video_key_map = new Map();
function loadVideoSources() {
	assert(config.hasOwnProperty("video_sources"));
	console.log("Reading video_sources from config:");
	let vsi = 0;
	for (let video_source of config.video_sources) {
		console.log(`video_source ${vsi++} : ${JSON.stringify(video_source)}`);
		assert(video_source.hasOwnProperty("name"));
		assert(video_source.hasOwnProperty("key"));
		video_key_map[video_source.name] = video_source.key;
	}
	if (config.hasOwnProperty("default_video_source")) {
		default_video_source = config.default_video_source;
	} else if (video_key_map.keys().length > 0) {
		default_video_source = video_key_map.keys()[0];
	}
}
loadVideoSources();

let meter_ids = [];
let audio_sources = new Map();

function loadAudioSources() {
	assert(config.hasOwnProperty("audio_sources"));
	console.log("Reading audio_source from config:");
	let asi = 0;
	for (let audio_source of config.audio_sources) {
		console.log(`audio_source ${asi++} : ${JSON.stringify(audio_source)}`);
		assert(audio_source.hasOwnProperty("meter_id"));
		assert(audio_source.hasOwnProperty("min_vol"));
		assert(audio_source.hasOwnProperty("video_source"));
		let id = audio_source.meter_id;

		meter_ids.push(id);
		audio_sources[id] = audio_source;
	}
}
loadAudioSources();


class SumBuffer {
	constructor() {
		this.size = config.sum_buffer_size;
		this.buffer = [];
		this.sum = 0;
	}

	getAverage() {
		return this.sum / this.buffer.length;
	}

	push(value) {
		if (this.buffer.length > this.size) {
			this.sum -= this.buffer.shift();
		}
		this.sum += value;
		this.buffer.push(value);
	}
}

assert(config.hasOwnProperty("vmix"));
const vmix = new Connection(config.vmix);
let vmix_connected = false;
console.log(`trying to connect to '${config.vmix}'`);

vmix.on('connect', () => {
	vmix_connected = true;
	console.log(`vmix(${config.vmix}) connected!`);
//	vmix.send('XML');
});
vmix.on('XML', (data) => {
	console.log(data);
}); 
vmix.on('close', () => {
	vmix_connected = false;
	console.log("Vmix connect failed");
});

function setVideoSource(video_source) {
	let key = video_key_map[video_source];
	if (key == undefined) {
		console.log(`Could not set source to '${video_source}', no corresponding key`);
		return;
	}
	if (!vmix_connected) {
		console.log(`VMIX not connected, cannot change video source! (tried to set ${video_source})`);
		return;
	}
	vmix.send({Input:key});
}

assert(config.hasOwnProperty("cumquat"));
const socket = io(config.cumquat);
console.log(`trying to connect to '${config.cumquat}'`);

let meter_buffers = {};

function onMeterUpdate(meters) {
	for (let id of meter_ids) {
		if (id >= meters.length) continue;
		if (!(id in meter_buffers)) {
			meter_buffers[id] = new SumBuffer();
		}
		meter_buffers[id].push(parseFloat(meters[id].val));
	}
}

socket.on("connect", () => {
	console.log(`cumquat connected (${config.cumquat}) (id: ${socket.id})`);

	socket.on("mixerMeters", (arg) => {
		//console.log("mixerMeters");
		//console.log(arg[1]);
		onMeterUpdate(arg[1]);
	});

});

socket.on("close", () => {
	console.log("Socketio connect failed");
});

function updateVideoSource() {
	let valid_sources = [];
	for (let id in meter_buffers) {
		const avg = meter_buffers[id].getAverage();
		if (avg > audio_sources[id].min_vol) {
			valid_sources.push({id: id, avg: avg});
		}			
	}
	
	let loudest_source = undefined;
	valid_sources.map((as) => {
		if (loudest_source == undefined || as.avg > loudest_source.avg) {
			loudest_source = as;
		} 
	});

	console.log(`loudest source: ${JSON.stringify(loudest_source)}`);
	let video_source = loudest_source == undefined ? default_video_source : audio_sources[loudest_source.id].video_source;
	setVideoSource(video_source);
}

assert(config.hasOwnProperty("switch_delay_ms"));
setInterval(updateVideoSource, config.switch_delay_ms);

