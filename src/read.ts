import { BufferReader } from './buffer-reader';
import { Container } from './container';
import { KTX2DataFormatDescriptor } from './ktx2-schema';

export function read(data: Uint8Array): Container {

	// Confirm this is a KTX 2.0 file, based on the identifier in the first 12 bytes.
	var idByteLength = 12;
	var id = new Uint8Array(data, 0, idByteLength);
	if (id[0] !== 0xAB || // '´'
		id[ 1 ] !== 0x4B || // 'K'
		id[ 2 ] !== 0x54 || // 'T'
		id[ 3 ] !== 0x58 || // 'X'
		id[ 4 ] !== 0x20 || // ' '
		id[ 5 ] !== 0x32 || // '2'
		id[ 6 ] !== 0x30 || // '0'
		id[ 7 ] !== 0xBB || // 'ª'
		id[ 8 ] !== 0x0D || // '\r'
		id[ 9 ] !== 0x0A || // '\n'
		id[ 10 ] !== 0x1A || // '\x1A'
		id[ 11 ] !== 0x0A // '\n'
	) {
		throw new Error( 'Missing KTX 2.0 identifier.' );
	}

	const container = new Container();

	///////////////////////////////////////////////////
	// Header.
	///////////////////////////////////////////////////

	const headerByteLength = 17 * Uint32Array.BYTES_PER_ELEMENT;
	const headerReader = new BufferReader( data, idByteLength, headerByteLength, true );

	container.vkFormat = headerReader._nextUint32();
	container.typeSize = headerReader._nextUint32();
	container.pixelWidth = headerReader._nextUint32();
	container.pixelHeight = headerReader._nextUint32();
	container.pixelDepth = headerReader._nextUint32();
	container.layerCount = headerReader._nextUint32();
	container.faceCount = headerReader._nextUint32();
	container.levelCount = headerReader._nextUint32();
	container.supercompressionScheme = headerReader._nextUint32();

	const dfdByteOffset = headerReader._nextUint32();
	const dfdByteLength = headerReader._nextUint32();
	const kvdByteOffset = headerReader._nextUint32();
	const kvdByteLength = headerReader._nextUint32();
	const sgdByteOffset = headerReader._nextUint64();
	const sgdByteLength = headerReader._nextUint64();

	///////////////////////////////////////////////////
	// Level index
	///////////////////////////////////////////////////

	const levelByteLength = container.levelCount * 3 * 8;
	const levelReader = new BufferReader(data, idByteLength + headerByteLength, levelByteLength, true);

	for (let i = 0; i < container.levelCount; i ++) {
		container.levelIndex.push({
			data: new Uint8Array(data, levelReader._nextUint64(), levelReader._nextUint64()),
			uncompressedByteLength: levelReader._nextUint64(),
		});
	}


	///////////////////////////////////////////////////
	// Data Format Descriptor (DFD)
	///////////////////////////////////////////////////

	const dfdReader = new BufferReader(data, dfdByteOffset, dfdByteLength, true);

	const sampleStart = 6;
	const sampleWords = 4;

	const dfd: KTX2DataFormatDescriptor = {
		vendorId: dfdReader._skip(4 /* totalSize */)._nextUint16(),
		versionNumber: dfdReader._skip(2 /* descriptorType */)._nextUint16(),
		descriptorBlockSize: dfdReader._nextUint16(),
		colorModel: dfdReader._nextUint8(),
		colorPrimaries: dfdReader._nextUint8(),
		transferFunction: dfdReader._nextUint8(),
		flags: dfdReader._nextUint8(),
		texelBlockDimension: {
			x: dfdReader._nextUint8() + 1,
			y: dfdReader._nextUint8() + 1,
			z: dfdReader._nextUint8() + 1,
			w: dfdReader._nextUint8() + 1,
		},
		bytesPlane0: dfdReader._nextUint8(),
		numSamples: 0,
		samples: [],
	};

	dfd.numSamples = (dfd.descriptorBlockSize / 4 - sampleStart) / sampleWords;

	dfdReader._skip(7 /* bytesPlane[1-7] */);

	for (let i = 0; i < dfd.numSamples; i ++) {
		dfd.samples[ i ] = {
			channelID: dfdReader._skip(3 /* bitOffset + bitLength */)._nextUint8(),
			// ... remainder not implemented.
		};
		dfdReader._skip(12 /* samplePosition[0-3], lower, upper */);
	}

	///////////////////////////////////////////////////
	// Key/Value Data (KVD)
	///////////////////////////////////////////////////

	// Not implemented.
	const kvd = {};


	///////////////////////////////////////////////////
	// Supercompression Global Data (SGD)
	///////////////////////////////////////////////////

	if (sgdByteLength <= 0) return container;

	const sgdReader = new BufferReader(
		data,
		sgdByteOffset,
		sgdByteLength,
		true
	);

	const endpointCount = sgdReader._nextUint16();
	const selectorCount = sgdReader._nextUint16();
	const endpointsByteLength = sgdReader._nextUint32();
	const selectorsByteLength = sgdReader._nextUint32();
	const tablesByteLength = sgdReader._nextUint32();
	const extendedByteLength = sgdReader._nextUint32();

	const imageDescs = [];
	for (let i = 0; i < container.levelCount; i ++) {
		imageDescs.push({
			imageFlags: sgdReader._nextUint32(),
			rgbSliceByteOffset: sgdReader._nextUint32(),
			rgbSliceByteLength: sgdReader._nextUint32(),
			alphaSliceByteOffset: sgdReader._nextUint32(),
			alphaSliceByteLength: sgdReader._nextUint32(),
		});
	}

	const endpointsByteOffset = sgdByteOffset + sgdReader._offset;
	const selectorsByteOffset = endpointsByteOffset + endpointsByteLength;
	const tablesByteOffset = selectorsByteOffset + selectorsByteLength;
	const extendedByteOffset = tablesByteOffset + tablesByteLength;

	const endpointsData = new Uint8Array(data, endpointsByteOffset, endpointsByteLength);
	const selectorsData = new Uint8Array(data, selectorsByteOffset, selectorsByteLength);
	const tablesData = new Uint8Array(data, tablesByteOffset, tablesByteLength);
	const extendedData = new Uint8Array(data, extendedByteOffset, extendedByteLength);

	container.globalData = {
		endpointCount,
		selectorCount,
		endpointsByteLength,
		selectorsByteLength,
		tablesByteLength,
		extendedByteLength,
		imageDescs,
		endpointsData,
		selectorsData,
		tablesData,
		extendedData,
	};

	return container;
}