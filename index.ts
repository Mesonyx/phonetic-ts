/*
 * Phonetic
 * Copyright 2013-2016 Tom Shawver
 * Conversion to TypeScript and removal of crypto dependency -- Adam Templeton, 2023
 */

import { Md5 } from 'ts-md5';
import { Buffer } from 'buffer';

interface PhoneticOptions {
  syllables?: number;
  seed?: string;
  phoneticSimplicity?: number;
  compoundSimplicity?: number;
  capFirst?: boolean;
}

interface PhoneticWordObject {
  numeric: number;
  lastSkippedPre: boolean;
  lastSkippedPost: boolean;
  word: string;
  opts: PhoneticOptions;
}

/**
 * Phonetics that sound best before a vowel.
 * @type {Array}
 */
const PHONETIC_PRE: string[] = [
  // Simple phonetics
  'b',
  'c',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  'm',
  'n',
  'p',
  'qu',
  'r',
  's',
  't',
  // Complex phonetics
  'bl',
  'ch',
  'cl',
  'cr',
  'dr',
  'fl',
  'fr',
  'gl',
  'gr',
  'kl',
  'kr',
  'ph',
  'pr',
  'pl',
  'sc',
  'sh',
  'sl',
  'sn',
  'sr',
  'st',
  'str',
  'sw',
  'th',
  'tr',
  'br',
  'v',
  'w',
  'y',
  'z',
];

/**
 * The number of simple phonetics within the 'pre' set.
 * @type {number}
 */
const PHONETIC_PRE_SIMPLE_LENGTH: number = 16;

/**
 * Vowel sound phonetics.
 * @type {Array}
 */
const PHONETIC_MID: string[] = [
  // Simple phonetics
  'a',
  'e',
  'i',
  'o',
  'u',
  // Complex phonetics
  'ee',
  'ie',
  'oo',
  'ou',
  'ue',
];

/**
 * The number of simple phonetics within the 'mid' set.
 * @type {number}
 */
const PHONETIC_MID_SIMPLE_LENGTH = 5;

/**
 * Phonetics that sound best after a vowel.
 * @type {Array}
 */
const PHONETIC_POST = [
  // Simple phonetics
  'b',
  'd',
  'f',
  'g',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'y',
  // Complex phonetics
  'ch',
  'ck',
  'ln',
  'nk',
  'ng',
  'rn',
  'sh',
  'sk',
  'st',
  'th',
  'x',
  'z',
];

/**
 * The number of simple phonetics within the 'post' set.
 * @type {number}
 */
const PHONETIC_POST_SIMPLE_LENGTH = 13;

/**
 * A mapping of regular expressions to replacements, which will be run on the
 * resulting word before it gets returned.  The purpose of replacements is to
 * address language subtleties that the phonetic builder is incapable of
 * understanding, such as 've' more pronounceable than just 'v' at the end of
 * a word, 'ey' more pronounceable than 'iy', etc.
 * @type {{}}
 */
const REPLACEMENTS = {
  quu: 'que',
  'qu([aeiou]){2}': 'qu$1',
  '[iu]y': 'ey',
  eye: 'ye',
  '(.)ye$': '$1y',
  '(^|e)cie(?!$)': '$1cei',
  '([vz])$': '$1e',
  '[iu]w': 'ow',
};

/**
 * Adds a single syllable to the word contained in the wordObj.  A syllable
 * contains, at maximum, a phonetic from each the PRE, MID, and POST phonetic
 * sets.  Some syllables will omit pre or post based on the
 * options.compoundSimplicity.
 *
 * @param {{word, numeric, lastSkippedPre, lastSkippedPost, opts}} wordObj The
 *      word object on which to operate.
 */
function addSyllable(wordObj: PhoneticWordObject) {
  var deriv = getDerivative(wordObj.numeric),
    compound = deriv % (wordObj.opts.compoundSimplicity ?? 5) == 0,
    first = wordObj.word == '',
    preOnFirst = deriv % 6 > 0;
  if ((first && preOnFirst) || wordObj.lastSkippedPost || compound) {
    wordObj.word += getNextPhonetic(
      PHONETIC_PRE,
      PHONETIC_PRE_SIMPLE_LENGTH,
      wordObj,
      false
    );
    wordObj.lastSkippedPre = false;
  } else wordObj.lastSkippedPre = true;
  wordObj.word += getNextPhonetic(
    PHONETIC_MID,
    PHONETIC_MID_SIMPLE_LENGTH,
    wordObj,
    first && wordObj.lastSkippedPre
  );
  if (wordObj.lastSkippedPre || compound) {
    wordObj.word += getNextPhonetic(
      PHONETIC_POST,
      PHONETIC_POST_SIMPLE_LENGTH,
      wordObj,
      false
    );
    wordObj.lastSkippedPost = false;
  } else wordObj.lastSkippedPost = true;
}

/**
 * Capitalizes the first letter of a string.
 *
 * @param {string} str A string to capitalize
 * @returns {string} The provided string with the first letter capitalized.
 */
function capFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Gets a derivative of a number by repeatedly dividing it by 7 and adding the
 * remainders together.  It's useful to base decisions on a derivative rather
 * than the wordObj's current numeric, as it avoids making the same decisions
 * around the same phonetics.
 *
 * @param {number} num A number from which a derivative should be calculated
 * @returns {number} The derivative.
 */
function getDerivative(num: number) {
  var derivative: number = 1;
  while (num != 0) {
    derivative += num % 7;
    num = Math.floor(num / 7);
  }
  return derivative;
}

/**
 * Combines the option defaults with the provided overrides.  Available
 * options are:
 *  - syllables: The number of syllables to put in the resulting word.
 *          Default is 3.
 *  - seed: A string or number with which to seed the generator.  Using the
 *          same seed (with the same other options) will coerce the generator
 *          into producing the same word.  Default is random.
 *  - phoneticSimplicity: The greater this number, the simpler the phonetics.
 *          For example, 1 might produce 'str' while 5 might produce 's' for
 *          the same syllable.  Minimum is 1, default is 5.
 *  - compoundSimplicity: The greater this number, the less likely the
 *          resulting word will sound "compound", such as "ripkuth" instead of
 *          "riputh".  Minimum is 1, default is 5.
 *  - capFirst: true to capitalize the first letter of the word; all lowercase
 *          otherwise.  Default is true.
 *
 * @param {{}} overrides A set of options and values with which to override
 *      the defaults.
 * @returns {{syllables, seed, phoneticSimplicity, compoundSimplicity, capFirst}}
 *      An options object.
 */
function getOptions(overrides: PhoneticOptions) {
  var options: PhoneticOptions = {};
  overrides = overrides || {};
  options.syllables = overrides.syllables || 3;
  options.seed = overrides.seed || randomBytes(16).toString('base64');
  options.phoneticSimplicity = overrides.phoneticSimplicity
    ? Math.max(overrides.phoneticSimplicity, 1)
    : 5;
  options.compoundSimplicity = overrides.compoundSimplicity
    ? Math.max(overrides.compoundSimplicity, 1)
    : 5;
  options.capFirst = overrides.hasOwnProperty('capFirst')
    ? overrides.capFirst
    : true;
  return options;
}

/**
 * Gets the next pseudo-random phonetic from a given phonetic set,
 * intelligently determining whether to include "complex" phonetics in that
 * set based on the options.phoneticSimplicity.
 *
 * @param {Array} phoneticSet The array of phonetics from which to choose
 * @param {number} simpleCap The number of 'simple' phonetics at the beginning
 *      of the phoneticSet
 * @param {{word, numeric, lastSkippedPre, lastSkippedPost, opts}} wordObj The
 *      wordObj for which the phonetic is being chosen
 * @param {boolean} [forceSimple] true to force a simple phonetic to be
 *      chosen; otherwise, the function will choose whether to include complex
 *      phonetics based on the derivative of wordObj.numeric.
 * @returns {string} The chosen phonetic.
 */
function getNextPhonetic(
  phoneticSet: string[],
  simpleCap: number,
  wordObj: PhoneticWordObject,
  forceSimple: boolean
) {
  var deriv = getDerivative(wordObj.numeric),
    simple =
      (wordObj.numeric + deriv) % (wordObj.opts.phoneticSimplicity || 5) > 0,
    cap = simple || forceSimple ? simpleCap : phoneticSet.length,
    phonetic = phoneticSet[wordObj.numeric % cap];
  wordObj.numeric = getNumericHash(wordObj.numeric + wordObj.word);
  return phonetic;
}

/**
 * Generates a numeric hash based on the input data.  The hash is an md5, with
 * each block of 32 bits converted to an integer and added together.
 *
 * @param {string|number} data The string or number to be hashed.
 * @returns {number}
 */
function getNumericHash(data: string | number) {
  const hash = new Md5();
  hash.appendStr(data + '-Phonetic');
  const hex = hash.end();
  if (typeof hex !== 'string') throw new Error('hex is not a string');
  const buf = Buffer.from(hex, 'hex');
  let numeric = 0;
  for (var i = 0; i <= 12; i += 4) numeric += buf.readUInt32LE(i);
  return numeric;
}

//  Write a function that generates a numeric hash based on the input data.  The hash is an md5, with each block of 32 bits converted to an integer and added together.

/**
 * Applies post-processing to a word after it has already been generated.  In
 * this phase, the REPLACEMENTS are executed, applying language intelligence
 * that can make generated words more pronounceable.  The first letter is
 * also capitalized.
 *
 * @param {{word, numeric, lastSkippedPre, lastSkippedPost, opts}} wordObj The
 *      word object to be processed.
 * @returns {string} The processed word.
 */
function postProcess(wordObj: PhoneticWordObject) {
  var regex;
  for (var i in REPLACEMENTS) {
    if (REPLACEMENTS.hasOwnProperty(i)) {
      regex = new RegExp(i);
      wordObj.word = wordObj.word.replace(
        regex,
        REPLACEMENTS[i as keyof typeof REPLACEMENTS]
      );
    }
  }
  if (wordObj.opts.capFirst) return capFirst(wordObj.word);
  return wordObj.word;
}

function randomBytes(size: number) {
  var buf = Buffer.alloc(size);
  for (var i = 0; i < 16; i++)
    buf.writeUInt8(Math.floor(Math.random() * 256), i);
  return buf;
}

export const phonetic = {
  /**
   * Generates a new word based on the given options.  For available options,
   * see getOptions.
   *
   * @param {*} [options] A collection of options to control the word generator.
   * @returns {string} A generated word.
   */
  generate: function (options: PhoneticOptions) {
    options = getOptions(options);
    var syllables = options.syllables || 3,
      wordObj = {
        numeric: getNumericHash(options.seed ?? ''),
        lastSkippedPre: false,
        lastSkippedPost: false,
        word: '',
        opts: options,
      };
    while (syllables--) addSyllable(wordObj);
    return postProcess(wordObj);
  },
};
