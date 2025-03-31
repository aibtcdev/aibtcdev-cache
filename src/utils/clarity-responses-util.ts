import {
	ClarityType,
	ClarityValue,
	cvToValue,
	ListCV,
	ResponseErrorCV,
	ResponseOkCV,
	SomeCV,
	TupleCV,
	uintCV,
	intCV,
	boolCV,
	principalCV,
	bufferCV,
	bufferCVFromString,
	stringAsciiCV,
	stringUtf8CV,
	listCV,
	tupleCV,
	noneCV,
	someCV,
	responseOkCV,
	responseErrorCV,
	ClarityWireType,
	clarityByteToType,
	Cl,
} from '@stacks/transactions';
import { ApiError } from './api-error-util';
import { ErrorCode } from './error-catalog-util';

/**
 * Interface for simplified Clarity value representation
 * Used for non-TypeScript clients to easily construct Clarity values
 */
export interface SimplifiedClarityValue {
	type: string;
	value: any;
}

/**
 * Recursively decodes Clarity values into JavaScript objects
 *
 * @param value - The Clarity value to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible (defaults to true for consistent BigInt handling)
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript representation of the Clarity value
 */
export function decodeClarityValues(value: ClarityValue, strictJsonCompat = true, preserveContainers = false): any {
	switch (value.type) {
		case ClarityType.Tuple:
			return decodeTupleRecursively(value as TupleCV, strictJsonCompat, preserveContainers);
		case ClarityType.List:
			return decodeListRecursively(value as ListCV, strictJsonCompat, preserveContainers);
		case ClarityType.OptionalSome:
			if (preserveContainers) {
				return {
					type: ClarityType.OptionalSome,
					value: decodeClarityValues((value as SomeCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as SomeCV).value, strictJsonCompat, preserveContainers);
		case ClarityType.ResponseOk:
			if (preserveContainers) {
				return {
					type: ClarityType.ResponseOk,
					value: decodeClarityValues((value as ResponseOkCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as ResponseOkCV).value, strictJsonCompat, preserveContainers);
		case ClarityType.ResponseErr:
			if (preserveContainers) {
				return {
					type: ClarityType.ResponseErr,
					value: decodeClarityValues((value as ResponseErrorCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as ResponseErrorCV).value, strictJsonCompat, preserveContainers);
		default:
			return cvToValue(value, strictJsonCompat);
	}
}

/**
 * Recursively decodes a Clarity tuple into a JavaScript object
 *
 * @param tuple - The Clarity tuple to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible (defaults to true for consistent BigInt handling)
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript object representation of the tuple
 */
export function decodeTupleRecursively(tuple: TupleCV, strictJsonCompat = true, preserveContainers = false): any {
	return Object.fromEntries(
		Object.entries(tuple.value).map(([key, value]) => {
			return [key, decodeClarityValues(value, strictJsonCompat, preserveContainers)];
		})
	);
}

/**
 * Recursively decodes a Clarity list into a JavaScript array
 *
 * @param list - The Clarity list to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible (defaults to true for consistent BigInt handling)
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript array representation of the list
 */
export function decodeListRecursively(list: ListCV, strictJsonCompat = true, preserveContainers = false): any[] {
	return list.value.map((value) => {
		return decodeClarityValues(value, strictJsonCompat, preserveContainers);
	});
}

/**
 * Safely converts a value to BigInt, handling string representations with or without 'n' suffix
 *
 * @param value - The value to convert to BigInt
 * @returns A BigInt representation of the value
 * @throws Error if the value cannot be converted to BigInt
 */
export function safeBigIntConversion(value: unknown): bigint {
	if (typeof value === 'bigint') {
		return value;
	}

	if (typeof value === 'number') {
		return BigInt(value);
	}

	if (typeof value === 'string') {
		// Remove 'n' suffix if present
		const cleanValue = value.endsWith('n') ? value.slice(0, -1) : value;
		return BigInt(cleanValue);
	}

	throw new Error(`Cannot convert ${typeof value} to BigInt`);
}

/**
 * Converts a simplified Clarity value representation to a proper ClarityValue object
 * This allows non-TypeScript clients to use a simpler JSON format for contract calls
 *
 * @param arg - Either a ClarityValue object or a simplified representation
 * @returns A proper ClarityValue object
 * @throws Error if the type is unsupported or the conversion fails
 */
export function convertToClarityValue(arg: ClarityValue | SimplifiedClarityValue): ClarityValue {
	// if it's an object with key 'type'
	if (typeof arg === 'object' && arg !== null && 'type' in arg) {
		// test if the type matches a known ClarityType
		if (Object.values(ClarityType).includes(arg.type as ClarityType)) {
			return arg as ClarityValue;
		}
		// test if the type matches a known ClarityWireType
		if (Object.values(ClarityWireType).includes(arg.type as unknown as ClarityWireType)) {
			// clone the arg
			const clonedArg = { ...arg };
			console.log({
				message: 'attempting to clone and serialize arg',
				arg: arg,
				clonedArg: clonedArg,
				convertedType: clarityByteToType(arg.type as unknown as ClarityWireType),
			});
			const serializedArg = Cl.serialize(clonedArg as ClarityValue);
			const deserializedArg = Cl.deserialize(serializedArg);
			// convert the type to ClarityType using clarityByteToType
			// clonedArg.type = clarityByteToType(arg.type as unknown as ClarityWireType) as ClarityType;
			// return the deserialized arg as ClarityValue
			return deserializedArg;
		}
		// test if we can parse it as a simple object
		const simplifiedArg = arg as SimplifiedClarityValue;
		const type = simplifiedArg.type.toLowerCase();
		try {
			switch (type) {
				case 'uint':
					// Handle both string and number inputs for uint
					return uintCV(
						typeof simplifiedArg.value === 'string'
							? BigInt(simplifiedArg.value.endsWith('n') ? simplifiedArg.value.slice(0, -1) : simplifiedArg.value)
							: BigInt(simplifiedArg.value)
					);
				case 'int':
					// Handle both string and number inputs for int
					return intCV(
						typeof simplifiedArg.value === 'string'
							? BigInt(simplifiedArg.value.endsWith('n') ? simplifiedArg.value.slice(0, -1) : simplifiedArg.value)
							: BigInt(simplifiedArg.value)
					);
				case 'bool':
					return boolCV(Boolean(simplifiedArg.value));
				case 'principal':
					return principalCV(String(simplifiedArg.value));
				case 'buffer':
					// Handle buffer conversion based on input format
					if (typeof simplifiedArg.value === 'string') {
						return bufferCVFromString(simplifiedArg.value);
					}
					return bufferCV(Buffer.from(simplifiedArg.value));
				case 'string':
				case 'stringascii':
					return stringAsciiCV(String(simplifiedArg.value));
				case 'stringutf8':
					return stringUtf8CV(String(simplifiedArg.value));
				case 'list':
					return listCV((simplifiedArg.value as SimplifiedClarityValue[]).map(convertToClarityValue));
				case 'tuple':
					const tupleObj: Record<string, ClarityValue> = {};
					Object.entries(simplifiedArg.value).forEach(([key, val]) => {
						tupleObj[key] = convertToClarityValue(val as SimplifiedClarityValue);
					});
					return tupleCV(tupleObj);
				case 'none':
					return noneCV();
				case 'optional':
				case 'some':
					return someCV(convertToClarityValue(simplifiedArg.value));
				case 'ok':
				case 'responseok':
					return responseOkCV(convertToClarityValue(simplifiedArg.value));
				case 'err':
				case 'responseerr':
					return responseErrorCV(convertToClarityValue(simplifiedArg.value));
				default:
					throw new ApiError(ErrorCode.VALIDATION_ERROR, {
						message: `Unsupported clarity type: ${simplifiedArg.type}`,
					});
			}
		} catch (error) {
			// If it's already an ApiError, rethrow it
			if (error instanceof ApiError) {
				throw error;
			}

			// Otherwise, wrap in an ApiError
			throw new ApiError(ErrorCode.VALIDATION_ERROR, {
				message: `Failed to convert to Clarity value of type ${type}`,
				error: error instanceof Error ? error.message : String(error),
				valueType: type,
			});
		}
	}
	// we don't know what it is
	throw new ApiError(ErrorCode.VALIDATION_ERROR, {
		message: 'Invalid Clarity value format. Expected an object with keys "type" and "value".',
		value: arg,
	});
}
