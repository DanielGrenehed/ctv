const { Connection } = require('node-vmix');
const io = require("socket.io-client");
const assert = require("assert");

const config = require("./config.json");
let meter_ids = [];
let audio_sources = new Map();

assert(config.hasOwnProperty("audio_sources"));
console.log("Reading audio_source from config:");
let asi = 0;
for (let audio_source of config.audio_sources) {
	console.log(`audio_source ${asi++}`);
	assert(audio_source.hasOwnProperty("meter_id"));
	assert(audio_source.hasOwnProperty("min_vol"));
	let id = audio_source.meter_id;

	meter_ids.push(id);
	audio_sources[id] = audio_source;
}

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
console.log(`trying to connect to '${config.vmix}'`);

vmix.on('connect', () => {
	console.log(`vmix(${config.vmix}) connected!`);
//	vmix.send('XML');
});
vmix.on('XML', (data) => {
	console.log(data);
}); 
vmix.on('close', () => {
	console.log("Vmix connect failed");
});

assert(config.hasOwnProperty("cumquat"));
const socket = io(config.cumquat);
console.log(`trying to connect to '${config.cumquat}'`);

let meter_buffers = new Map();

function onMeterUpdate(meters) {
	for (let id of meter_ids) {
		if (id >= meters.length) continue;
		if (!(id in meter_buffers)) {
			meter_buffers[id] = new SumBuffer();
		}
		meter_buffers[id].push(parseFloat(meters[id]));
	}
}

socket.on("connect", () => {
	console.log(`cumquat connected (${config.cumquat}) (id: ${socket.id})`);

	socket.on("mixerMeters", (arg) => {
		onMeterUpdate(arg);
	});

});

socket.on("close", () => {
	console.log("Socketio connect failed");
});

// socket.emit("channel", "arg");

function updateVideoSource() {
	//console.log("updateVideoSource");
	let valid_sources = [];
	for (let id in meter_buffers) {
		const avg = meter_buffers[id].getAverage();
		if (avg > audio_sources[id].min_vol) {
			console.log(`[${id}], ${avg}`);
			valid_sources.push({id: id, avg: avg});
		}			
	}
	
	let loudest_source = undefined;


}

/*
 *	listen to sources from cumquat
 *	minimum strength 
 *	then when highest for long enough
 *	change vmix source to corresponding camera
 *	store time since last camera change, and 
 *	do not allow the camera to change too rapidly.
 *
 *	at an interval, list all inputs that have 
 *	an average surpassing their min-volume, 
 *	then get the one with the highest average
 *	volume. get that inputs corresponding camera,
 *	and set it as the video input in vmix
 *
 * */
assert(config.hasOwnProperty("switch_delay_ms"));
setInterval(updateVideoSource, config.switch_delay_ms);

